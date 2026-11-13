import { describe, expect, it } from "vitest";
import type { AuctionSnapshot, Bid } from "@auction/shared";
import { bidderStanding, formatRemaining, pickNewer, pickNewerList } from "../src/lib/view";

const ME = "me-id";
const OTHER = "other-id";

const bid = (bidderId: string, amountCents: number, id = `${bidderId}-${amountCents}`): Bid => ({
  id,
  bidderId,
  bidderName: bidderId === ME ? "Me" : "Other",
  amountCents,
  createdAt: 0,
});

function snapshot(overrides: Partial<AuctionSnapshot> = {}): AuctionSnapshot {
  return {
    id: "a1",
    title: "Item",
    description: "Desc",
    sellerName: "Sam",
    startingPriceCents: 1000,
    minIncrementCents: 100,
    createdAt: 0,
    endsAt: 100_000,
    status: "live",
    highestBid: null,
    minNextBidCents: 1000,
    bidCount: 0,
    recentBids: [],
    serverTime: 1000,
    ...overrides,
  };
}

describe("pickNewer", () => {
  it("takes the first snapshot", () => {
    const s = snapshot();
    expect(pickNewer(null, s)).toBe(s);
  });

  it("ignores an older snapshot that arrives late (e.g. a bid response overtaken by an SSE push)", () => {
    const newer = snapshot({ serverTime: 2000, bidCount: 2 });
    const older = snapshot({ serverTime: 1500, bidCount: 1 });
    expect(pickNewer(newer, older)).toBe(newer);
    expect(pickNewer(older, newer)).toBe(newer);
  });

  it("on equal server time prefers the one with more bids", () => {
    const fewer = snapshot({ serverTime: 2000, bidCount: 1 });
    const more = snapshot({ serverTime: 2000, bidCount: 2 });
    expect(pickNewer(more, fewer)).toBe(more);
    expect(pickNewer(fewer, more)).toBe(more);
  });
});

describe("pickNewerList", () => {
  it("keeps the live list with the latest server time", () => {
    const older = { auctions: [], serverTime: 1000 };
    const newer = { auctions: [], serverTime: 2000 };
    expect(pickNewerList(null, older)).toBe(older);
    expect(pickNewerList(older, newer)).toBe(newer);
    expect(pickNewerList(newer, older)).toBe(newer);
  });
});

describe("bidderStanding", () => {
  it("leading while my bid is highest", () => {
    const mine = bid(ME, 1000);
    expect(bidderStanding(snapshot({ highestBid: mine, recentBids: [mine] }), ME, false)).toBe("leading");
  });

  it("outbid once someone else leads after I bid", () => {
    const mine = bid(ME, 1000);
    const theirs = bid(OTHER, 1100);
    expect(bidderStanding(snapshot({ highestBid: theirs, recentBids: [theirs, mine] }), ME, false)).toBe("outbid");
  });

  it("outbid even when my bid scrolled out of the recent list (remembered participation)", () => {
    const theirs = bid(OTHER, 5000);
    expect(bidderStanding(snapshot({ highestBid: theirs, recentBids: [theirs] }), ME, true)).toBe("outbid");
  });

  it("just watching when I never bid", () => {
    const theirs = bid(OTHER, 1100);
    expect(bidderStanding(snapshot({ highestBid: theirs, recentBids: [theirs] }), ME, false)).toBe("watching");
  });

  it("won / lost / watching after the end", () => {
    const mine = bid(ME, 1000);
    const theirs = bid(OTHER, 1100);
    expect(bidderStanding(snapshot({ status: "ended", highestBid: mine, recentBids: [mine] }), ME, false)).toBe("won");
    expect(bidderStanding(snapshot({ status: "ended", highestBid: theirs, recentBids: [theirs, mine] }), ME, false)).toBe(
      "lost",
    );
    expect(bidderStanding(snapshot({ status: "ended", highestBid: theirs, recentBids: [theirs] }), ME, false)).toBe(
      "watching",
    );
    expect(bidderStanding(snapshot({ status: "ended" }), ME, false)).toBe("watching");
  });

  it("decides by bidder id, not by name: another 'Me' is not me", () => {
    const impostor = { ...bid(OTHER, 1100), bidderName: "Me" };
    expect(bidderStanding(snapshot({ status: "ended", highestBid: impostor, recentBids: [impostor] }), ME, true)).toBe(
      "lost",
    );
  });
});

describe("formatRemaining", () => {
  it.each([
    [0, "0:00"],
    [-500, "0:00"],
    [1, "0:01"], // rounds up: never shows 0:00 while time is left
    [999, "0:01"],
    [1000, "0:01"],
    [1001, "0:02"],
    [42_000, "0:42"],
    [245_000, "4:05"],
    [3_723_000, "1:02:03"],
    [2 * 86_400_000 + 4 * 3_600_000 + 10 * 60_000, "2d 4h 10m"],
  ])("%i ms → %s", (ms, expected) => {
    expect(formatRemaining(ms)).toBe(expected);
  });
});
