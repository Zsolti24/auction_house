import { MAX_AMOUNT_CENTS } from "./constants";

/**
 * Accepts "152", "152.5", "152.50", "1,50" (comma decimal), optional "€" and surrounding spaces.
 * Rejects negatives, more than two decimals, thousands separators and anything non-numeric.
 */
const EURO_INPUT = /^(\d+)(?:[.,](\d{1,2}))?$/;

export type EuroParseResult =
  | { ok: true; cents: number }
  /** "invalid": not an amount at all; "too_large": a valid amount above MAX_AMOUNT_CENTS. */
  | { ok: false; reason: "invalid" | "too_large" };

/**
 * Parses user-typed euros into integer cents using string arithmetic only (no parseFloat),
 * so "0.29" becomes exactly 29 and never 28.999… Says *why* an input is rejected, so the UI can
 * tell "not a number" apart from "too large".
 */
export function parseEuro(input: string): EuroParseResult {
  const normalized = input.trim().replace(/^€\s*/, "");
  const match = EURO_INPUT.exec(normalized);
  if (!match) return { ok: false, reason: "invalid" };

  const [, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  // Very long digit strings lose precision as a Number, but they are far above the limit anyway.
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return { ok: false, reason: "too_large" };
  return { ok: true, cents };
}

/** Like parseEuro, but just the cents or null. */
export function parseEuroToCents(input: string): number | null {
  const result = parseEuro(input);
  return result.ok ? result.cents : null;
}

/** "That amount is too large. The maximum is €1,000,000,000.00." */
export function tooLargeAmountMessage(): string {
  return `That amount is too large. The maximum is ${formatCents(MAX_AMOUNT_CENTS)}.`;
}

/** 15250 → "€152.50", 123456789 → "€1,234,567.89". Deterministic: no Intl/locale dependence. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (abs % 100).toString().padStart(2, "0");
  return `${sign}€${whole}.${fraction}`;
}

/** 15250 → "152.50". Used to pre-fill the bid input with the minimum next bid. */
export function centsToInputValue(cents: number): string {
  return `${Math.floor(cents / 100)}.${(cents % 100).toString().padStart(2, "0")}`;
}
