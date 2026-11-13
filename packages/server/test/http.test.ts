import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AuctionSnapshot,
  Bid,
  CreateAuctionResponse,
  AuctionListSnapshot,
  PlaceBidResponse,
  SellerSnapshot,
} from "@auction/shared";
import { auctionInput, bidder, FakeClock, ShiftedClock, T0 } from "./helpers";
import { startServer } from "./httpHelpers";

const END = T0 + 10 * 60_000; // auctionInput() default end time

describe("HTTP API", () => {
  let clock: FakeClock;
  let server: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    clock = new FakeClock();
    server = await startServer({ clock });
  });
  afterEach(() => server.close());

  async function createAuction(overrides = {}) {
    const res = await server.post<CreateAuctionResponse>("/api/auctions", auctionInput(overrides));
    expect(res.status).toBe(201);
    return res.body;
  }

  const placeBid = (id: string, body: object) => server.post<PlaceBidResponse>(`/api/auctions/${id}/bids`, body);

  it("health check", async () => {
    expect(await server.get("/api/health")).toEqual({ status: 200, body: { ok: true } });
  });

  describe("main flow", () => {
    it("create → two bidders bid several times → auction ends → winner declared", async () => {
      const { id, sellerKey } = await createAuction();
      const anna = bidder("Anna");
      const bob = bidder("Bob");

      let leader: string | null = null;
      for (const [who, amountCents] of [
        [anna, 10_000],
        [bob, 10_500],
        [anna, 12_000],
        [bob, 13_000],
        [anna, 15_250],
      ] as const) {
        clock.advance(60_000);
        const res = await placeBid(id, { ...who, amountCents, expectedLeadingBidId: leader });
        expect(res.status).toBe(201);
        if (res.body.accepted) leader = res.body.bid.id;
      }

      const live = await server.get<AuctionSnapshot>(`/api/auctions/${id}`);
      expect(live.body).toMatchObject({ status: "live", bidCount: 5, minNextBidCents: 15_750 });

      clock.set(END);
      const ended = await server.get<AuctionSnapshot>(`/api/auctions/${id}`);
      expect(ended.body.status).toBe("ended");
      expect(ended.body.highestBid).toMatchObject({ bidderId: anna.bidderId, bidderName: "Anna", amountCents: 15_250 });

      const seller = await server.get<SellerSnapshot>(`/api/auctions/${id}/seller?key=${sellerKey}`);
      expect(seller.body.bids.map((b) => [b.bidderName, b.amountCents])).toEqual([
        ["Anna", 15_250],
        ["Bob", 13_000],
        ["Anna", 12_000],
        ["Bob", 10_500],
        ["Anna", 10_000],
      ]);
    });
  });

  describe("bids placed at the same moment", () => {
    it("20 parallel requests for the same amount: exactly one is accepted", async () => {
      const { id } = await createAuction();

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          placeBid(id, { ...bidder(`Bidder ${i}`), amountCents: 10_000, expectedLeadingBidId: null }),
        ),
      );

      const accepted = responses.filter((r) => r.status === 201);
      const rejected = responses.filter((r) => r.status === 409);
      expect(accepted).toHaveLength(1);
      expect(rejected).toHaveLength(19);
      expect(new Set(rejected.map((r) => !r.body.accepted && r.body.reason))).toEqual(new Set(["OUTBID"]));

      const snap = await server.get<AuctionSnapshot>(`/api/auctions/${id}`);
      expect(snap.body.bidCount).toBe(1);
    });

    it("50 parallel bids with random amounts: every accepted bid beats the previous one by the increment", async () => {
      const { id, sellerKey } = await createAuction(); // €100 start, €5 increment
      const amounts = Array.from({ length: 50 }, () => 10_000 + Math.floor(Math.random() * 40) * 100);

      const responses = await Promise.all(
        amounts.map((amountCents, i) => placeBid(id, { ...bidder(`B${i}`), amountCents, expectedLeadingBidId: null })),
      );
      const acceptedCount = responses.filter((r) => r.status === 201).length;
      expect(acceptedCount).toBeGreaterThanOrEqual(1);

      const { body } = await server.get<SellerSnapshot>(`/api/auctions/${id}/seller?key=${sellerKey}`);
      const chronological: Bid[] = [...body.bids].reverse();
      expect(chronological).toHaveLength(acceptedCount);
      expect(chronological[0]!.amountCents).toBeGreaterThanOrEqual(10_000);
      for (let i = 1; i < chronological.length; i++) {
        expect(chronological[i]!.amountCents).toBeGreaterThanOrEqual(chronological[i - 1]!.amountCents + 500);
      }
      expect(body.highestBid?.amountCents).toBe(chronological.at(-1)!.amountCents);
    });
  });

  describe("auction end", () => {
    it("a bid placed after the auction has ended is rejected with 409 AUCTION_ENDED", async () => {
      const { id } = await createAuction();
      clock.set(END + 1);
      const res = await placeBid(id, { ...bidder("Late"), amountCents: 99_900, expectedLeadingBidId: null });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ accepted: false, reason: "AUCTION_ENDED", snapshot: { status: "ended", bidCount: 0 } });
    });
  });

  describe("anti-sniping", () => {
    it("a bid in the last 30 s extends the end, and every watcher is told the new end time", async () => {
      const { id } = await createAuction();
      const watcherA = await server.stream<AuctionSnapshot>(`/api/auctions/${id}/events`);
      const watcherB = await server.stream<AuctionSnapshot>(`/api/auctions/${id}/events`);
      expect((await watcherA.next()).endsAt).toBe(END);
      expect((await watcherB.next()).endsAt).toBe(END);

      clock.set(END - 10_000);
      const res = await placeBid(id, { ...bidder("Sniper"), amountCents: 10_000, expectedLeadingBidId: null });
      expect(res.status).toBe(201);
      expect(res.body.snapshot.endsAt).toBe(END + 20_000);

      for (const watcher of [watcherA, watcherB]) {
        const pushed = await watcher.next();
        expect(pushed.endsAt).toBe(END + 20_000);
        expect(pushed.highestBid?.bidderName).toBe("Sniper");
      }
      watcherA.close();
      watcherB.close();
    });
  });

  describe("real-time stream", () => {
    it("sends the current state on connect and a fresh snapshot after each accepted bid", async () => {
      const { id } = await createAuction();
      const stream = await server.stream<AuctionSnapshot>(`/api/auctions/${id}/events`);
      expect(stream.contentType).toContain("text/event-stream");
      expect(await stream.next()).toMatchObject({ id, bidCount: 0, highestBid: null });

      await placeBid(id, { ...bidder("Anna"), amountCents: 10_000, expectedLeadingBidId: null });
      expect(await stream.next()).toMatchObject({ bidCount: 1, highestBid: { bidderName: "Anna" }, minNextBidCents: 10_500 });

      // A rejected bid changes nothing, so nothing is pushed; the next push is the next real change.
      await placeBid(id, { ...bidder("Cheap"), amountCents: 1, expectedLeadingBidId: null });
      await placeBid(id, { ...bidder("Bob"), amountCents: 11_000, expectedLeadingBidId: null });
      expect(await stream.next()).toMatchObject({ bidCount: 2, highestBid: { bidderName: "Bob" } });
      stream.close();
    });

    it("a reconnecting client immediately gets the current state", async () => {
      const { id } = await createAuction();
      await placeBid(id, { ...bidder("Anna"), amountCents: 10_000, expectedLeadingBidId: null });
      const late = await server.stream<AuctionSnapshot>(`/api/auctions/${id}/events`);
      expect(await late.next()).toMatchObject({ bidCount: 1, highestBid: { bidderName: "Anna" } });
      late.close();
    });

    it("the seller stream requires the key and contains every bid", async () => {
      const { id, sellerKey } = await createAuction();
      expect((await server.get(`/api/auctions/${id}/seller/events?key=wrong`)).status).toBe(403);

      const seller = await server.stream<SellerSnapshot>(`/api/auctions/${id}/seller/events?key=${sellerKey}`);
      expect((await seller.next()).bids).toEqual([]);
      await placeBid(id, { ...bidder("Anna"), amountCents: 10_000, expectedLeadingBidId: null });
      const pushed = await seller.next();
      expect(pushed.bids).toHaveLength(1);
      expect(pushed.bids[0]).toMatchObject({ bidderName: "Anna", amountCents: 10_000, createdAt: clock.now() });
      seller.close();
    });
  });

  describe("ending early", () => {
    it("bidders, the seller and the auction list are all told right away", async () => {
      const { id, sellerKey } = await createAuction();
      const bidderStream = await server.stream<AuctionSnapshot>(`/api/auctions/${id}/events`);
      const sellerStream = await server.stream<SellerSnapshot>(`/api/auctions/${id}/seller/events?key=${sellerKey}`);
      const lobby = await server.stream<AuctionListSnapshot>("/api/lobby/events");
      await bidderStream.next();
      await sellerStream.next();
      expect((await lobby.next()).live.map((a) => a.id)).toEqual([id]);

      clock.advance(30_000);
      const res = await server.post<SellerSnapshot>(`/api/auctions/${id}/end`, { sellerKey });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "ended", endedEarly: true, endsAt: T0 + 30_000 });

      expect(await bidderStream.next()).toMatchObject({ status: "ended", endedEarly: true, highestBid: null });
      expect(await sellerStream.next()).toMatchObject({ status: "ended", endedEarly: true });
      expect(await lobby.next()).toMatchObject({ live: [], ended: [{ id, endedEarly: true, leaderName: null }] });
      for (const s of [bidderStream, sellerStream, lobby]) s.close();
    });

    it("is refused with 409 once there is a bid, and 403 without the right key", async () => {
      const { id, sellerKey } = await createAuction();
      expect((await server.post(`/api/auctions/${id}/end`, { sellerKey: "wrong" })).status).toBe(403);
      await placeBid(id, { ...bidder("Anna"), amountCents: 10_000, expectedLeadingBidId: null });

      const res = await server.post(`/api/auctions/${id}/end`, { sellerKey });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: "CONFLICT" });
      expect((await server.get<AuctionSnapshot>(`/api/auctions/${id}`)).body).toMatchObject({ status: "live", bidCount: 1 });
    });

    it("a bid and an end-early arriving at the same moment: exactly one of them wins", async () => {
      // The server handles requests in arrival order, so which one is sent first decides the
      // winner. Alternate the order so both outcomes are exercised — and check they both were.
      const outcomes = new Set<string>();
      for (let round = 0; round < 10; round++) {
        const { id, sellerKey } = await createAuction();
        const sendBid = () => placeBid(id, { ...bidder("Anna"), amountCents: 10_000, expectedLeadingBidId: null });
        const sendEnd = () => server.post(`/api/auctions/${id}/end`, { sellerKey });
        const [bid, end] =
          round % 2 === 0
            ? await Promise.all([sendBid(), sendEnd()])
            : await Promise.all([sendEnd(), sendBid()]).then(([e, b]) => [b, e] as const);
        const final = (await server.get<AuctionSnapshot>(`/api/auctions/${id}`)).body;
        outcomes.add(bid.status === 201 ? "bid won" : "end won");

        if (bid.status === 201) {
          expect(end.status).toBe(409); // the bid came first: no longer allowed to end early
          expect(final).toMatchObject({ status: "live", bidCount: 1, endedEarly: false });
        } else {
          expect(end.status).toBe(200); // ending came first: the bid is too late
          expect(bid.body).toMatchObject({ accepted: false, reason: "AUCTION_ENDED" });
          expect(final).toMatchObject({ status: "ended", bidCount: 0, endedEarly: true });
        }
      }
      expect(outcomes).toEqual(new Set(["bid won", "end won"]));
    });
  });

  describe("auction list (lobby)", () => {
    it("lists running auctions soonest end first, and ended ones most recent first, with leader / winner", async () => {
      const later = await createAuction({ title: "Later", endsAt: T0 + 20 * 60_000 });
      const sooner = await createAuction({ title: "Sooner", endsAt: T0 + 5 * 60_000, sellerName: "Sue" });
      const soonest = await createAuction({ title: "Soonest", endsAt: T0 + 2 * 60_000 });
      const first = await placeBid(later.id, { ...bidder("Anna"), amountCents: 12_000, expectedLeadingBidId: null });
      await placeBid(later.id, {
        ...bidder("Bob"),
        amountCents: 13_000,
        expectedLeadingBidId: first.body.accepted ? first.body.bid.id : null,
      });

      const { status, body } = await server.get<AuctionListSnapshot>("/api/lobby");
      expect(status).toBe(200);
      expect(body.ended).toEqual([]);
      expect(body.live).toEqual([
        { id: soonest.id, title: "Soonest", sellerName: "Sam", currentPriceCents: 10_000, bidCount: 0, endsAt: T0 + 2 * 60_000, leaderName: null, endedEarly: false },
        { id: sooner.id, title: "Sooner", sellerName: "Sue", currentPriceCents: 10_000, bidCount: 0, endsAt: T0 + 5 * 60_000, leaderName: null, endedEarly: false },
        { id: later.id, title: "Later", sellerName: "Sam", currentPriceCents: 13_000, bidCount: 2, endsAt: T0 + 20 * 60_000, leaderName: "Bob", endedEarly: false },
      ]);

      clock.set(T0 + 5 * 60_000); // "Soonest" and "Sooner" have ended (exactly at endsAt counts as ended)
      const after = (await server.get<AuctionListSnapshot>("/api/lobby")).body;
      expect(after.live.map((a) => a.title)).toEqual(["Later"]);
      expect(after.ended.map((a) => a.title)).toEqual(["Sooner", "Soonest"]); // most recently ended first

      clock.set(T0 + 20 * 60_000);
      const final = (await server.get<AuctionListSnapshot>("/api/lobby")).body;
      expect(final.live).toEqual([]);
      expect(final.ended[0]).toMatchObject({ title: "Later", currentPriceCents: 13_000, leaderName: "Bob" });
    });

    it("pushes the updated lists when an auction is created or gets a bid", async () => {
      const stream = await server.stream<AuctionListSnapshot>("/api/lobby/events");
      expect(await stream.next()).toMatchObject({ live: [], ended: [] });

      const { id } = await createAuction({ title: "Lamp" });
      expect((await stream.next()).live).toMatchObject([{ id, title: "Lamp", bidCount: 0, leaderName: null }]);

      await placeBid(id, { ...bidder("Anna"), amountCents: 11_000, expectedLeadingBidId: null });
      expect((await stream.next()).live).toMatchObject([{ id, currentPriceCents: 11_000, bidCount: 1, leaderName: "Anna" }]);

      // A rejected bid changes nothing, so the next push is the next real change.
      await placeBid(id, { ...bidder("Cheap"), amountCents: 1, expectedLeadingBidId: null });
      const second = await createAuction({ title: "Clock", endsAt: T0 + 60_000 });
      expect((await stream.next()).live.map((a) => a.id)).toEqual([second.id, id]);
      stream.close();
    });
  });

  describe("errors", () => {
    it("invalid auction input → 400 with a message per field", async () => {
      const res = await server.post("/api/auctions", auctionInput({ startingPriceCents: 0, endsAt: T0 - 1 }));
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        error: "VALIDATION_ERROR",
        fieldErrors: {
          startingPriceCents: ["Starting price must be greater than €0"],
          endsAt: ["End time must be in the future"],
        },
      });
    });

    it("malformed JSON → 400", async () => {
      const res = await fetch(`${server.baseUrl}/api/auctions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "VALIDATION_ERROR" });
    });

    it("unknown auction → 404 on every endpoint", async () => {
      expect((await server.get("/api/auctions/nope")).status).toBe(404);
      expect((await server.get("/api/auctions/nope/events")).status).toBe(404);
      expect((await placeBid("nope", { ...bidder("A"), amountCents: 100, expectedLeadingBidId: null })).status).toBe(404);
    });

    it("wrong or missing seller key → 403", async () => {
      const { id } = await createAuction();
      expect((await server.get(`/api/auctions/${id}/seller?key=wrong`)).status).toBe(403);
      expect((await server.get(`/api/auctions/${id}/seller`)).status).toBe(403);
    });
  });
});

describe("timers and restarts (real timers)", () => {
  let dir: string;
  let clock: ShiftedClock;
  const servers: Array<Awaited<ReturnType<typeof startServer>>> = [];
  const start = async (dbPath?: string) => {
    const server = await startServer({ dbPath, clock });
    servers.push(server);
    return server;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "auction-http-"));
    clock = new ShiftedClock();
  });
  afterEach(async () => {
    // Close every server even if the test failed: Windows cannot delete an open SQLite file.
    await Promise.all(servers.splice(0).map((s) => s.close()));
    rmSync(dir, { recursive: true, force: true });
  });

  it("streams send a named ping heartbeat so clients can detect a dead connection", async () => {
    const server = await startServer({ clock, sseHeartbeatMs: 50 });
    servers.push(server);
    const { body } = await server.post<CreateAuctionResponse>("/api/auctions", auctionInput({ endsAt: clock.now() + 60_000 }));
    const stream = await server.stream<AuctionSnapshot>(`/api/auctions/${body.id}/events`);
    expect((await stream.next()).id).toBe(body.id);
    expect(await stream.nextEventOfType("ping", 1_000)).toBe("{}");
    expect(await stream.nextEventOfType("ping", 1_000)).toBe("{}");
    stream.close();
  });

  it("an auction moves from live to ended on the list by itself when it ends", async () => {
    // No bid here: a bid this close to the end would extend it by 30 s (anti-sniping).
    // Winner details in the ended list are covered by the fake-clock lobby test.
    const server = await start();
    const { body } = await server.post<CreateAuctionResponse>("/api/auctions", auctionInput({ endsAt: clock.now() + 300 }));
    const stream = await server.stream<AuctionListSnapshot>("/api/lobby/events");
    expect(await stream.next()).toMatchObject({ live: [{ id: body.id }], ended: [] });

    const after = await stream.next(2_000); // pushed by the end timer, nobody asked
    expect(after.live).toEqual([]);
    expect(after.ended).toMatchObject([{ id: body.id, leaderName: null }]);
    stream.close();
  });

  it("watchers are told the auction ended, without asking, at the end time", async () => {
    const server = await start();
    const { body } = await server.post<CreateAuctionResponse>("/api/auctions", auctionInput({ endsAt: clock.now() + 300 }));
    const stream = await server.stream<AuctionSnapshot>(`/api/auctions/${body.id}/events`);
    expect((await stream.next()).status).toBe("live");

    const ended = await stream.next(2_000);
    expect(ended.status).toBe("ended");
    expect(ended.serverTime).toBeGreaterThanOrEqual(ended.endsAt);
    stream.close();
  });

  it("state, winner and the end notification survive a server restart", async () => {
    const dbPath = join(dir, "auction.db");

    // Ends in 60 s, so the bid below is outside the anti-sniping window and does not extend it.
    const first = await start(dbPath);
    const endsAt = clock.now() + 60_000;
    const { body: created } = await first.post<CreateAuctionResponse>("/api/auctions", auctionInput({ endsAt }));
    await first.post(`/api/auctions/${created.id}/bids`, { ...bidder("Anna"), amountCents: 10_000, expectedLeadingBidId: null });
    const before = (await first.get<AuctionSnapshot>(`/api/auctions/${created.id}`)).body;
    expect(before.endsAt).toBe(endsAt); // not extended
    await first.close(); // server goes down mid-auction

    clock.jump(60_000 - 500); // while it is down, time passes: 0.5 s left
    const second = await start(dbPath);
    const stream = await second.stream<AuctionSnapshot>(`/api/auctions/${created.id}/events`);
    const onConnect = await stream.next();
    expect(onConnect).toMatchObject({ status: "live", endsAt: before.endsAt, bidCount: 1, highestBid: before.highestBid });

    // The end timer was rebuilt from the database: the "ended" push still arrives.
    const ended = await stream.next(2_000);
    expect(ended).toMatchObject({ status: "ended", highestBid: { bidderName: "Anna", amountCents: 10_000 } });
    stream.close();

    const seller = await second.get<SellerSnapshot>(`/api/auctions/${created.id}/seller?key=${created.sellerKey}`);
    expect(seller.body.bids).toHaveLength(1);
  });
});
