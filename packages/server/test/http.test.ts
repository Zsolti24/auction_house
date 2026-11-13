import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuctionSnapshot, Bid, CreateAuctionResponse, PlaceBidResponse, SellerSnapshot } from "@auction/shared";
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
