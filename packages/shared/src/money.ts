import { MAX_AMOUNT_CENTS } from "./constants";

/**
 * Accepts "152", "152.5", "152.50", "1,50" (comma decimal), optional "€" and surrounding spaces.
 * Rejects negatives, more than two decimals, thousands separators and anything non-numeric.
 */
const EURO_INPUT = /^(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * Parses user-typed euros into integer cents using string arithmetic only (no parseFloat),
 * so "0.29" becomes exactly 29 and never 28.999…
 * Returns null when the input is not a valid non-negative amount.
 */
export function parseEuroToCents(input: string): number | null {
  const normalized = input.trim().replace(/^€\s*/, "");
  const match = EURO_INPUT.exec(normalized);
  if (!match) return null;

  const [, whole, fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) return null;
  return cents;
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
