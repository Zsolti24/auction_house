import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { ApiError } from "@auction/shared";
import { AuctionService } from "./auctionService";
import { systemClock, type Clock } from "./clock";
import { openDatabase } from "./db";
import { EndTimers } from "./endTimers";
import { HttpError } from "./errors";
import { AuctionHub } from "./hub";

export interface AppOptions {
  /** SQLite file path, or ":memory:". */
  dbPath: string;
  clock?: Clock;
  /** How often SSE streams send a `ping` event so clients can detect dead connections. */
  sseHeartbeatMs?: number;
}

type IdParams = { Params: { id: string } };
type SellerParams = IdParams & { Querystring: { key?: string } };

export function buildApp({ dbPath, clock = systemClock, sseHeartbeatMs = 10_000 }: AppOptions) {
  // Destroy open connections on close: SSE streams never end by themselves and would
  // otherwise keep `app.close()` waiting forever.
  const app = Fastify({ logger: false, forceCloseConnections: true });

  const db = openDatabase(dbPath);
  const service = new AuctionService(db, clock);
  const hub = new AuctionHub(service);
  const timers = new EndTimers(
    clock,
    (id) => {
      try {
        return service.getSnapshot(id).endsAt;
      } catch {
        return undefined;
      }
    },
    (id) => hub.publish(id),
  );

  // After a restart, re-arm the end notification for every auction that is still running.
  for (const auction of service.liveAuctions()) timers.schedule(auction.id, auction.endsAt);

  app.addHook("onClose", async () => {
    timers.cancelAll();
    db.close();
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) return reply.status(error.statusCode).send(error.body);

    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      // Fastify's own client errors: malformed JSON, wrong content type, body too large…
      const body: ApiError = { error: "VALIDATION_ERROR", message: (error as Error).message };
      return reply.status(statusCode).send(body);
    }

    console.error(error);
    return reply.status(500).send({ error: "INTERNAL_ERROR", message: "Something went wrong" });
  });

  app.setNotFoundHandler((_request, reply) => {
    const body: ApiError = { error: "NOT_FOUND", message: "Not found" };
    return reply.status(404).send(body);
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.post("/api/auctions", async (request, reply) => {
    const created = service.createAuction(request.body);
    timers.schedule(created.id, service.getSnapshot(created.id).endsAt);
    hub.publishLobby(); // the new auction appears on everyone's live list
    return reply.status(201).send(created);
  });

  /** Auction list: running auctions (ending soonest first) and recently ended ones. */
  app.get("/api/lobby", async () => service.getAuctionList());

  /**
   * Auction list as SSE: full lists on connect and whenever an auction is created, bid on or
   * ends (the end timer's publish moves it from `live` to `ended` for everyone).
   */
  app.get("/api/lobby/events", (request, reply) => {
    openEventStream(request, reply, service.getAuctionList(), sseHeartbeatMs, (send) => hub.subscribeLobby(send));
  });

  app.get<IdParams>("/api/auctions/:id", async (request) => service.getSnapshot(request.params.id));

  app.get<SellerParams>("/api/auctions/:id/seller", async (request) =>
    service.getSellerSnapshot(request.params.id, request.query.key ?? ""),
  );

  /** 201 with the accepted bid, or 409 with the reason. Both carry the fresh snapshot. */
  app.post<IdParams>("/api/auctions/:id/bids", async (request, reply) => {
    const { id } = request.params;
    const result = service.placeBid(id, request.body);
    if (!result.accepted) return reply.status(409).send(result);

    hub.publish(id); // auction watchers + live list (new price)
    timers.schedule(id, result.snapshot.endsAt); // end time may have moved (anti-sniping)
    return reply.status(201).send(result);
  });

  app.get<IdParams>("/api/auctions/:id/events", (request, reply) => {
    const { id } = request.params;
    const initial = service.getSnapshot(id); // throws 404 before the stream is opened
    openEventStream(request, reply, initial, sseHeartbeatMs, (send) => hub.subscribe(id, { view: "public", send }));
  });

  app.get<SellerParams>("/api/auctions/:id/seller/events", (request, reply) => {
    const { id } = request.params;
    const sellerKey = request.query.key ?? "";
    const initial = service.getSellerSnapshot(id, sellerKey); // 404 / 403 before the stream opens
    openEventStream(request, reply, initial, sseHeartbeatMs, (send) =>
      hub.subscribe(id, { view: "seller", sellerKey, send }),
    );
  });

  return app;
}

/**
 * Server-Sent Events: the first message is the full current state, then one full snapshot per
 * change. Reading the initial snapshot and subscribing happen in the same synchronous tick, so no
 * change can slip in between. The browser's EventSource reconnects by itself (after `retry` ms)
 * and the reconnect again starts with a full snapshot.
 *
 * Heartbeat: a named `ping` event (visible to client JS, unlike an SSE comment). A proxy can keep
 * the browser's side of a stream open after the server died; the client treats a long silence
 * as a dead connection and reconnects.
 */
function openEventStream<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  initial: T,
  heartbeatMs: number,
  subscribe: (send: (data: T) => void) => () => void,
): void {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (data: T) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  res.write("retry: 2000\n\n");
  send(initial);

  const unsubscribe = subscribe(send);
  const heartbeat = setInterval(() => res.write("event: ping\ndata: {}\n\n"), heartbeatMs);
  request.raw.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
