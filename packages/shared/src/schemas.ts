import { z } from "zod";
import { MAX_AMOUNT_CENTS } from "./constants";

const amountCents = (label: string) =>
  z
    .number({ error: `${label} is required` })
    .int(`${label} must be in whole cents`)
    .positive(`${label} must be greater than €0`)
    .max(MAX_AMOUNT_CENTS, `${label} is too large`);

/** One rule for every display name (bidder and seller): 1–50 characters after trimming. */
export const DISPLAY_NAME_MAX = 50;
export const displayNameSchema = z
  .string({ error: "Display name is required" })
  .trim()
  .min(1, "Display name is required")
  .max(DISPLAY_NAME_MAX, `Display name must be at most ${DISPLAY_NAME_MAX} characters`);

/**
 * Create-auction input. "End time in the past" depends on the clock, so the schema is built
 * per request with the caller's `now`: the server passes its own clock, the web form passes
 * Date.now() for instant feedback (the server check is the one that counts).
 */
export function createAuctionInputSchema(now: number) {
  return z.object({
    title: z
      .string({ error: "Title is required" })
      .trim()
      .min(1, "Title is required")
      .max(200, "Title must be at most 200 characters"),
    description: z
      .string({ error: "Description is required" })
      .trim()
      .min(1, "Description is required")
      .max(1000, "Description must be at most 1000 characters"),
    startingPriceCents: amountCents("Starting price"),
    minIncrementCents: amountCents("Minimum bid increment"),
    endsAt: z
      .number({ error: "End time is required" })
      .int("End time must be a timestamp")
      .refine((endsAt) => endsAt > now, "End time must be in the future"),
    /** Display name of the seller, shown on the auction ("Offered by …"). */
    sellerName: displayNameSchema,
  });
}

export type CreateAuctionInput = z.infer<ReturnType<typeof createAuctionInputSchema>>;

export const placeBidInputSchema = z.object({
  bidderId: z.uuid("Invalid bidder id"),
  bidderName: displayNameSchema,
  amountCents: amountCents("Bid"),
  /** Id of the leading bid the bidder saw when bidding (null = no bids yet). Distinguishes OUTBID from TOO_LOW. */
  expectedLeadingBidId: z.string().nullable(),
});

export type PlaceBidInput = z.infer<typeof placeBidInputSchema>;

/** Flattens a zod error into `{ field: [messages] }` for ApiError.fieldErrors and form display. */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}
