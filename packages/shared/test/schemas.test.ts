import { describe, expect, it } from "vitest";
import { createAuctionInputSchema, placeBidInputSchema, toFieldErrors } from "../src/schemas";

const NOW = 1_800_000_000_000;

const validAuction = {
  title: "Vintage camera",
  description: "Leica M3, 1956, working condition",
  startingPriceCents: 10000,
  minIncrementCents: 250,
  endsAt: NOW + 60_000,
  sellerName: "Sam",
};

function auctionErrors(input: unknown) {
  const result = createAuctionInputSchema(NOW).safeParse(input);
  return result.success ? {} : toFieldErrors(result.error);
}

describe("createAuctionInputSchema", () => {
  it("accepts a valid auction and trims text", () => {
    const parsed = createAuctionInputSchema(NOW).parse({ ...validAuction, title: "  Camera  " });
    expect(parsed.title).toBe("Camera");
  });

  it.each([0, -100])("rejects starting price %i with a clear message", (startingPriceCents) => {
    expect(auctionErrors({ ...validAuction, startingPriceCents })).toEqual({
      startingPriceCents: ["Starting price must be greater than €0"],
    });
  });

  it.each([0, -1])("rejects increment %i", (minIncrementCents) => {
    expect(auctionErrors({ ...validAuction, minIncrementCents })).toEqual({
      minIncrementCents: ["Minimum bid increment must be greater than €0"],
    });
  });

  it("rejects an amount above the maximum with a specific message (server-side check)", () => {
    expect(auctionErrors({ ...validAuction, startingPriceCents: 100_000_000_001 })).toEqual({
      startingPriceCents: ["Starting price is too large — the maximum is €1,000,000,000.00"],
    });
  });

  it("rejects fractional cents", () => {
    expect(auctionErrors({ ...validAuction, startingPriceCents: 100.5 })).toHaveProperty("startingPriceCents");
  });

  it.each([
    ["in the past", NOW - 1],
    ["exactly now", NOW],
  ])("rejects an end time %s", (_label, endsAt) => {
    expect(auctionErrors({ ...validAuction, endsAt })).toEqual({
      endsAt: ["End time must be in the future"],
    });
  });

  it("rejects a blank title and reports every invalid field at once", () => {
    const errors = auctionErrors({ ...validAuction, title: "   ", startingPriceCents: 0 });
    expect(Object.keys(errors).sort()).toEqual(["startingPriceCents", "title"]);
  });

  it.each([
    ["title", 200],
    ["description", 1000],
  ] as const)("enforces the %s length limit of %i characters", (field, max) => {
    expect(auctionErrors({ ...validAuction, [field]: "a".repeat(max) })).toEqual({});
    expect(auctionErrors({ ...validAuction, [field]: "a".repeat(max + 1) })).toHaveProperty(field);
  });

  it("rejects missing fields", () => {
    expect(Object.keys(auctionErrors({})).sort()).toEqual([
      "description",
      "endsAt",
      "minIncrementCents",
      "sellerName",
      "startingPriceCents",
      "title",
    ]);
  });

  it.each([
    ["blank", "   ", "Display name is required"],
    ["too long", "a".repeat(51), "Display name must be at most 50 characters"],
  ])("rejects a %s seller name", (_label, sellerName, message) => {
    expect(auctionErrors({ ...validAuction, sellerName })).toEqual({ sellerName: [message] });
  });
});

describe("placeBidInputSchema", () => {
  const validBid = {
    bidderId: "3f1c2b9e-8a4d-4c7e-9b1a-2d3e4f5a6b7c",
    bidderName: "Anna",
    amountCents: 15250,
    expectedLeadingBidId: null,
  };

  it("accepts a valid bid", () => {
    expect(placeBidInputSchema.safeParse(validBid).success).toBe(true);
  });

  it("enforces the display name length limit of 50 characters", () => {
    expect(placeBidInputSchema.safeParse({ ...validBid, bidderName: "a".repeat(50) }).success).toBe(true);
    expect(placeBidInputSchema.safeParse({ ...validBid, bidderName: "a".repeat(51) }).success).toBe(false);
  });

  it.each([
    ["zero amount", { amountCents: 0 }],
    ["blank name", { bidderName: "  " }],
    ["non-uuid bidder id", { bidderId: "anna" }],
    ["missing expectedLeadingBidId", { expectedLeadingBidId: undefined }],
  ])("rejects %s", (_label, override) => {
    expect(placeBidInputSchema.safeParse({ ...validBid, ...override }).success).toBe(false);
  });
});
