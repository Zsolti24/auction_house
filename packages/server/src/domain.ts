import { ANTI_SNIPING_WINDOW_MS, type AuctionStatus, type BidRejectionReason } from "@auction/shared";

/**
 * Pure bidding rules. No I/O, no clock — `now` is passed in — so every rule is unit-testable
 * and the service only has to load state, call these, and persist the outcome atomically.
 */

/** An auction is over from the exact millisecond of `endsAt`: a bid at `now === endsAt` is late. */
export function deriveStatus(endsAt: number, now: number): AuctionStatus {
  return now >= endsAt ? "ended" : "live";
}

/** First bid may equal the starting price; every later bid must beat the leader by the increment. */
export function minNextBid(
  startingPriceCents: number,
  minIncrementCents: number,
  highestAmountCents: number | null,
): number {
  return highestAmountCents === null ? startingPriceCents : highestAmountCents + minIncrementCents;
}

export interface BidEvaluationInput {
  now: number;
  endsAt: number;
  amountCents: number;
  /** Minimum the server would accept right now. */
  minNextCents: number;
  /** Leading bid id right now (null = no bids). */
  leadingBidId: string | null;
  /** Leading bid id the bidder saw when they bid. */
  expectedLeadingBidId: string | null;
  /** Minimum next bid in the state the bidder saw (Infinity if that state is unknown). */
  minNextAsSeenCents: number;
}

export type BidEvaluation =
  | { accepted: true; newEndsAt: number }
  | { accepted: false; reason: BidRejectionReason };

export function evaluateBid(input: BidEvaluationInput): BidEvaluation {
  if (deriveStatus(input.endsAt, input.now) === "ended") {
    return { accepted: false, reason: "AUCTION_ENDED" };
  }

  if (input.amountCents < input.minNextCents) {
    // OUTBID only if the bid would have been valid in the state the bidder saw and someone
    // else changed that state since. A bid that was too low even then is just TOO_LOW.
    const leaderChanged = input.leadingBidId !== input.expectedLeadingBidId;
    const wasValidAsSeen = input.amountCents >= input.minNextAsSeenCents;
    return { accepted: false, reason: leaderChanged && wasValidAsSeen ? "OUTBID" : "TOO_LOW" };
  }

  return { accepted: true, newEndsAt: extendForAntiSniping(input.endsAt, input.now) };
}

/** A bid in the last 30 seconds moves the end to 30 seconds after the bid; never shortens it. */
export function extendForAntiSniping(endsAt: number, bidTime: number): number {
  return endsAt - bidTime <= ANTI_SNIPING_WINDOW_MS ? bidTime + ANTI_SNIPING_WINDOW_MS : endsAt;
}
