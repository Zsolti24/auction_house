import { describe, expect, it } from "vitest";
import { centsToInputValue, formatCents, parseEuroToCents } from "../src/money";

describe("parseEuroToCents", () => {
  it.each([
    ["152", 15200],
    ["152.5", 15250],
    ["152.50", 15250],
    ["1,50", 150],
    ["0.29", 29], // parseFloat("0.29") * 100 = 28.999999999999996
    ["0.01", 1],
    ["0", 0],
    ["  12.30 ", 1230],
    ["€12.30", 1230],
    ["€ 12", 1200],
  ])("parses %j as %i cents", (input, expected) => {
    expect(parseEuroToCents(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    "abc",
    "-5",
    "1.234", // three decimals
    "1.000,00", // thousands separator
    "1,000.00",
    "1e3",
    ".50",
    "12.",
    "Infinity",
    "NaN",
    "99999999999", // above MAX_AMOUNT_CENTS
  ])("rejects %j", (input) => {
    expect(parseEuroToCents(input)).toBeNull();
  });
});

describe("formatCents", () => {
  it.each([
    [0, "€0.00"],
    [5, "€0.05"],
    [15250, "€152.50"],
    [123456789, "€1,234,567.89"],
    [-150, "-€1.50"],
  ])("formats %i as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });
});

describe("centsToInputValue", () => {
  it("round-trips with parseEuroToCents", () => {
    for (const cents of [1, 99, 100, 15250, 100_000_01]) {
      expect(parseEuroToCents(centsToInputValue(cents))).toBe(cents);
    }
  });
});
