import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECENT_BIDS_LIMIT, type PlaceBidResponse } from "@auction/shared";
import { auctionInput, bidder, expectHttpError, FakeClock, makeService, T0 } from "./helpers";

function accepted(res: PlaceBidResponse) {
  if (!res.accepted) throw new Error(`Expected accepted bid, got ${res.reason}: ${res.message}`);
  return res;
}

function rejected(res: PlaceBidResponse) {
  if (res.accepted) throw new Error(`Expected rejected bid, got accepted ${res.bid.amountCents}`);
  return res;
}

describe("AuctionService", () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });
  afterEach(() => ctx.db.close());

  describe("main flow", () => {
    it("two bidders bid several times, the auction ends, the highest bidder wins", () => {
      const { service, clock } = ctx;
      const { id } = service.createAuction(auctionInput()); // €100 start, €5 increment, ends T0+10min
      const anna = bidder("Anna");
      const bob = bidder("Bob");

      let leader: string | null = null;
      const bid = (who: typeof anna, amountCents: number) => {
        clock.advance(30_000);
        const res = accepted(service.placeBid(id, { ...who, amountCents, expectedLeadingBidId: leader }));
        leader = res.bid.id;
        return res;
      };

      bid(anna, 10_000); // first bid at the starting price
      bid(bob, 10_500);
      bid(anna, 12_000);
      const last = bid(bob, 15_250);

      expect(last.snapshot.highestBid).toMatchObject({ bidderName: "Bob", amountCents: 15_250 });
      expect(last.snapshot.minNextBidCents).toBe(15_750);
      expect(last.snapshot.bidCount).toBe(4);
      expect(last.snapshot.recentBids.map((b) => b.amountCents)).toEqual([15_250, 12_000, 10_500, 10_000]);
      expect(last.snapshot.status).toBe("live");

      clock.set(T0 + 10 * 60_000); // exactly the end time
      const final = service.getSnapshot(id);
      expect(final.status).toBe("ended");
      expect(final.highestBid).toMatchObject({ bidderId: bob.bidderId, bidderName: "Bob", amountCents: 15_250 });
    });

    it("an auction without bids ends with no winner", () => {
      const { service, clock } = ctx;
      const { id } = service.createAuction(auctionInput());
      clock.advance(11 * 60_000);
      expect(service.getSnapshot(id)).toMatchObject({ status: "ended", highestBid: null, bidCount: 0 });
    });

    it("the leader may raise their own bid", () => {
      const { service } = ctx;
      const { id } = service.createAuction(auctionInput());
      const anna = bidder("Anna");
      const first = accepted(service.placeBid(id, { ...anna, amountCents: 10_000, expectedLeadingBidId: null }));
      accepted(service.placeBid(id, { ...anna, amountCents: 11_000, expectedLeadingBidId: first.bid.id }));
    });
  });

  describe("bid validation", () => {
    it("rejects a first bid below the starting price as TOO_LOW", () => {
      const { service } = ctx;
      const { id } = service.createAuction(auctionInput());
      const res = rejected(service.placeBid(id, { ...bidder("Anna"), amountCents: 9_999, expectedLeadingBidId: null }));
      expect(res.reason).toBe("TOO_LOW");
      expect(res.message).toBe("Your bid is too low. The minimum bid is €100.00.");
      expect(res.snapshot.bidCount).toBe(0);
    });

    it("rejects a bid that beats the leader by less than the increment", () => {
      const { service } = ctx;
      const { id } = service.createAuction(auctionInput());
      const first = accepted(service.placeBid(id, { ...bidder("Anna"), amountCents: 10_000, expectedLeadingBidId: null }));
      const res = rejected(
        service.placeBid(id, { ...bidder("Bob"), amountCents: 10_499, expectedLeadingBidId: first.bid.id }),
      );
      expect(res.reason).toBe("TOO_LOW");
    });

    it("rejects malformed input with field errors", () => {
      const { service } = ctx;
      const { id } = service.createAuction(auctionInput());
      const err = expectHttpError(() => service.placeBid(id, { bidderName: "", amountCents: -1 }), 400);
      expect(Object.keys(err.body.fieldErrors ?? {})).toEqual(
        expect.arrayContaining(["bidderId", "bidderName", "amountCents", "expectedLeadingBidId"]),
      );
    });

    it("returns 404 for an unknown auction", () => {
      expectHttpError(
        () => ctx.service.placeBid("nope", { ...bidder("Anna"), amountCents: 10_000, expectedLeadingBidId: null }),
        404,
      );
      expectHttpError(() => ctx.service.getSnapshot("nope"), 404);
    });
  });

  describe("simultaneous bids", () => {
    it("of the same amount from the same seen state: exactly one is accepted, the others are OUTBID", () => {
      const { service } = ctx;
      const { id } = service.createAuction(auctionInput());
      const opening = accepted(service.placeBid(id, { ...bidder("Seed"), amountCents: 10_000, expectedLeadingBidId: null }));

      // Ten bidders all saw the same leader and all bid the minimum at the same server millisecond.
      const results = Array.from({ length: 10 }, (_, i) =>
        service.placeBid(id, { ...bidder(`B${i}`), amountCents: 10_500, expectedLeadingBidId: opening.bid.id }),
      );

      expect(results.filter((r) => r.accepted)).toHaveLength(1);
      expect(results.filter((r) => !r.accepted).map((r) => !r.accepted && r.reason)).toEqual(Array(9).fill("OUTBID"));
      const snap = service.getSnapshot(id);
      expect(snap.bidCount).toBe(2);
      expect(snap.highestBid?.amountCents).toBe(10_500);
    });

    it("concurrent bids from the same seen state are each judged against the state at arrival", () => {
      const { service } = ctx;
      const { id } = service.createAuction(auctionInput()); // €5 increment
      const opening = accepted(service.placeBid(id, { ...bidder("Seed"), amountCents: 10_000, expectedLeadingBidId: null }));
      const seen = opening.bid.id;

      // All three saw the €100 leader. Anna arrives first and becomes leader at €105.
      accepted(service.placeBid(id, { ...bidder("Anna"), amountCents: 10_500, expectedLeadingBidId: seen }));
      // Bob bid enough to beat Anna by the increment as well → still accepted.
      accepted(service.placeBid(id, { ...bidder("Bob"), amountCents: 11_000, expectedLeadingBidId: seen }));
      // Carol's €108 was valid for what she saw, but not any more → OUTBID with the new minimum.
      const carol = rejected(service.placeBid(id, { ...bidder("Carol"), amountCents: 10_800, expectedLeadingBidId: seen }));
      expect(carol.reason).toBe("OUTBID");
      expect(carol.message).toBe("Someone else bid in the meantime. The minimum bid is now €115.00.");
      expect(carol.snapshot.highestBid).toMatchObject({ bidderName: "Bob", amountCents: 11_000 });
    });

    it("an unknown expectedLeadingBidId never turns TOO_LOW into OUTBID", () => {
      const { service } = ctx;
      const { id } = service.createAuction(auctionInput());
      accepted(service.placeBid(id, { ...bidder("Anna"), amountCents: 10_000, expectedLeadingBidId: null }));
      const res = rejected(service.placeBid(id, { ...bidder("Bob"), amountCents: 10_100, expectedLeadingBidId: "made-up" }));
      expect(res.reason).toBe("TOO_LOW");
    });
  });

  describe("auction end", () => {
    it("rejects a bid placed after the auction has ended, without storing it", () => {
      const { service, clock } = ctx;
      const { id } = service.createAuction(auctionInput());
      clock.set(T0 + 10 * 60_000 + 1);
      const res = rejected(service.placeBid(id, { ...bidder("Late"), amountCents: 50_000, expectedLeadingBidId: null }));
      expect(res.reason).toBe("AUCTION_ENDED");
      expect(res.message).toBe("The auction has already ended.");
      expect(service.getSnapshot(id)).toMatchObject({ status: "ended", bidCount: 0, highestBid: null });
    });

    it("rejects a bid arriving exactly at the end time", () => {
      const { service, clock } = ctx;
      const { id } = service.createAuction(auctionInput());
      clock.set(T0 + 10 * 60_000);
      expect(rejected(service.placeBid(id, { ...bidder("Late"), amountCents: 10_000, expectedLeadingBidId: null })).reason).toBe(
        "AUCTION_ENDED",
      );
    });
  });

  describe("anti-sniping", () => {
    const END = T0 + 10 * 60_000;

    it("a bid 10 s before the end pushes the end to 30 s after the bid", () => {
      const { service, clock } = ctx;
      const { id } = service.createAuction(auctionInput());
      clock.set(END - 10_000);
      const res = accepted(service.placeBid(id, { ...bidder("Sniper"), amountCents: 10_000, expectedLeadingBidId: null }));
      expect(res.snapshot.endsAt).toBe(END + 20_000);
      expect(service.getSnapshot(id).endsAt).toBe(END + 20_000); // persisted, visible to everyone
    });

    it("a bid 31 s before the end does not extend", () => {
      const { service, clock } = ctx;
      const { id } = service.createAuction(auctionInput());
      clock.set(END - 31_000);
      expect(
        accepted(service.placeBid(id, { ...bidder("Early"), amountCents: 10_000, expectedLeadingBidId: null })).snapshot.endsAt,
      ).toBe(END);
    });

    it("bids after the original end are accepted while extended, and extensions chain", () => {
      const { service, clock } = ctx;
      const { id } = service.createAuction(auctionInput());

      clock.set(END - 5_000);
      const a = accepted(service.placeBid(id, { ...bidder("Anna"), amountCents: 10_000, expectedLeadingBidId: null }));
      expect(a.snapshot.endsAt).toBe(END + 25_000);

      clock.set(END + 20_000); // past the original end, inside the extension
      const b = accepted(service.placeBid(id, { ...bidder("Bob"), amountCents: 10_500, expectedLeadingBidId: a.bid.id }));
      expect(b.snapshot.endsAt).toBe(END + 50_000);

      clock.set(END + 50_000);
      expect(service.getSnapshot(id)).toMatchObject({ status: "ended", highestBid: { bidderName: "Bob" } });
    });

    it("a rejected bid in the last 30 s does not extend the auction", () => {
      const { service, clock } = ctx;
      const { id } = service.createAuction(auctionInput());
      clock.set(END - 10_000);
      rejected(service.placeBid(id, { ...bidder("Cheap"), amountCents: 1, expectedLeadingBidId: null }));
      expect(service.getSnapshot(id).endsAt).toBe(END);
    });
  });

  describe("create auction", () => {
    it("rejects invalid input with a message per field", () => {
      const err = expectHttpError(
        () => ctx.service.createAuction(auctionInput({ startingPriceCents: 0, minIncrementCents: -5, endsAt: T0 - 1 })),
        400,
      );
      expect(err.body.fieldErrors).toEqual({
        startingPriceCents: ["Starting price must be greater than €0"],
        minIncrementCents: ["Minimum bid increment must be greater than €0"],
        endsAt: ["End time must be in the future"],
      });
    });

    it("validates the end time against the server clock, not the client's", () => {
      ctx.clock.set(T0 + 60 * 60_000); // server is an hour ahead of what the client thought
      expectHttpError(() => ctx.service.createAuction(auctionInput({ endsAt: T0 + 30 * 60_000 })), 400);
    });
  });

  describe("seller view", () => {
    it("requires the seller key and shows every bid, newest first", () => {
      const { service } = ctx;
      const { id, sellerKey } = service.createAuction(auctionInput({ minIncrementCents: 1 }));
      let leader: string | null = null;
      for (let i = 0; i < RECENT_BIDS_LIMIT + 5; i++) {
        leader = accepted(
          service.placeBid(id, { ...bidder(`B${i}`), amountCents: 10_000 + i, expectedLeadingBidId: leader }),
        ).bid.id;
      }

      const seller = service.getSellerSnapshot(id, sellerKey);
      expect(seller.bids).toHaveLength(RECENT_BIDS_LIMIT + 5);
      expect(seller.bids[0]?.amountCents).toBe(10_000 + RECENT_BIDS_LIMIT + 4);
      expect(seller.recentBids).toHaveLength(RECENT_BIDS_LIMIT); // public snapshot stays bounded

      expectHttpError(() => service.getSellerSnapshot(id, "wrong-key"), 403);
      expectHttpError(() => service.getSellerSnapshot(id, ""), 403);
    });
  });
});

describe("persistence across restarts", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "auction-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a restarted server sees the same bids, extended end time and winner", () => {
    const dbPath = join(dir, "auction.db");
    const clock = new FakeClock();
    const END = T0 + 10 * 60_000;

    const first = makeService(dbPath, clock);
    const { id, sellerKey } = first.service.createAuction(auctionInput());
    const a = accepted(first.service.placeBid(id, { ...bidder("Anna"), amountCents: 10_000, expectedLeadingBidId: null }));
    clock.set(END - 10_000);
    accepted(first.service.placeBid(id, { ...bidder("Bob"), amountCents: 11_000, expectedLeadingBidId: a.bid.id }));
    const before = first.service.getSnapshot(id);
    first.db.close(); // "server stops"

    const second = makeService(dbPath, clock); // "server starts" with the same file
    expect(second.service.getSnapshot(id)).toEqual(before);
    expect(second.service.liveAuctions().map((x) => x.id)).toEqual([id]);
    expect(second.service.getSellerSnapshot(id, sellerKey).bids).toHaveLength(2);

    clock.set(END + 20_000);
    expect(second.service.getSnapshot(id)).toMatchObject({ status: "ended", highestBid: { bidderName: "Bob" } });
    expect(second.service.liveAuctions()).toEqual([]);
    second.db.close();
  });

  it("does not store the seller key in plain text", () => {
    const dbPath = join(dir, "auction.db");
    const { db, service } = makeService(dbPath);
    const { sellerKey } = service.createAuction(auctionInput());
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
    expect(readFileSync(dbPath).includes(Buffer.from(sellerKey))).toBe(false);
  });
});
