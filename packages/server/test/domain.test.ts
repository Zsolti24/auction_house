import { describe, expect, it } from "vitest";
import { deriveStatus, evaluateBid, extendForAntiSniping, minNextBid, type BidEvaluationInput } from "../src/domain";

const END = 1_000_000;

describe("deriveStatus", () => {
  it("is live until the last millisecond and ended exactly at endsAt", () => {
    expect(deriveStatus(END, END - 1)).toBe("live");
    expect(deriveStatus(END, END)).toBe("ended");
    expect(deriveStatus(END, END + 1)).toBe("ended");
  });
});

describe("minNextBid", () => {
  it("is the starting price when there are no bids", () => {
    expect(minNextBid(10_000, 500, null)).toBe(10_000);
  });

  it("is the highest bid plus the increment afterwards", () => {
    expect(minNextBid(10_000, 500, 12_000)).toBe(12_500);
  });
});

describe("evaluateBid", () => {
  const base: BidEvaluationInput = {
    now: END - 60_000,
    endsAt: END,
    amountCents: 12_500,
    minNextCents: 12_500,
    leadingBidId: "b1",
    expectedLeadingBidId: "b1",
    minNextAsSeenCents: 12_500,
  };

  it("accepts a bid of exactly the minimum", () => {
    expect(evaluateBid(base)).toEqual({ accepted: true, newEndsAt: END });
  });

  it("rejects one cent below the minimum as TOO_LOW", () => {
    expect(evaluateBid({ ...base, amountCents: 12_499 })).toEqual({ accepted: false, reason: "TOO_LOW" });
  });

  it("rejects as OUTBID when the bid was enough for what the bidder saw but someone bid since", () => {
    expect(
      evaluateBid({ ...base, leadingBidId: "b2", minNextCents: 13_000, expectedLeadingBidId: "b1", minNextAsSeenCents: 12_500 }),
    ).toEqual({ accepted: false, reason: "OUTBID" });
  });

  it("rejects as TOO_LOW when the bid was too low even for what the bidder saw", () => {
    expect(
      evaluateBid({
        ...base,
        amountCents: 12_000,
        leadingBidId: "b2",
        minNextCents: 13_000,
        expectedLeadingBidId: "b1",
        minNextAsSeenCents: 12_500,
      }),
    ).toEqual({ accepted: false, reason: "TOO_LOW" });
  });

  it("rejects at exactly endsAt even if the amount is fine", () => {
    expect(evaluateBid({ ...base, now: END })).toEqual({ accepted: false, reason: "AUCTION_ENDED" });
  });

  it("reports AUCTION_ENDED before checking the amount", () => {
    expect(evaluateBid({ ...base, now: END + 1, amountCents: 1 })).toEqual({ accepted: false, reason: "AUCTION_ENDED" });
  });
});

describe("extendForAntiSniping", () => {
  it("does not extend a bid placed more than 30 s before the end", () => {
    expect(extendForAntiSniping(END, END - 30_001)).toBe(END);
  });

  it("at exactly 30 s before the end, the new end equals the old one", () => {
    expect(extendForAntiSniping(END, END - 30_000)).toBe(END);
  });

  it.each([29_999, 10_000, 1])("a bid %i ms before the end pushes the end to bid time + 30 s", (msBeforeEnd) => {
    const bidTime = END - msBeforeEnd;
    expect(extendForAntiSniping(END, bidTime)).toBe(bidTime + 30_000);
  });
});
