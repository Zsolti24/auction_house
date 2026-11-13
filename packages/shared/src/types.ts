/** All money values are integer cents. All timestamps are epoch milliseconds from the server clock. */

export type AuctionStatus = "live" | "ended";

export interface Bid {
  id: string;
  bidderId: string;
  bidderName: string;
  amountCents: number;
  createdAt: number;
}

/**
 * What every participant sees. Sent on GET and as every SSE message — always the full state,
 * never a diff, so a client that reconnects or reloads is immediately correct.
 */
export interface AuctionSnapshot {
  id: string;
  title: string;
  description: string;
  startingPriceCents: number;
  minIncrementCents: number;
  createdAt: number;
  /** Current end time; moves forward on anti-sniping extensions. */
  endsAt: number;
  status: AuctionStatus;
  /** Leading bid while live; the winning bid once ended. Null if nobody has bid. */
  highestBid: Bid | null;
  /** Smallest amount the server would accept right now. Computed by the server only. */
  minNextBidCents: number;
  bidCount: number;
  /** Newest first, at most RECENT_BIDS_LIMIT entries. */
  recentBids: Bid[];
  /** Server clock when the snapshot was produced; clients use it to correct their countdown. */
  serverTime: number;
}

/** Seller view: same as the public snapshot but with the complete bid history (newest first). */
export interface SellerSnapshot extends AuctionSnapshot {
  bids: Bid[];
}

export interface CreateAuctionResponse {
  id: string;
  /** Secret that grants access to the seller view. Only returned once, at creation. */
  sellerKey: string;
}

export type BidRejectionReason =
  /** Below the minimum next bid, and the leader is the one the bidder saw. */
  | "TOO_LOW"
  /** Would have been enough, but someone else bid in the meantime. */
  | "OUTBID"
  /** The auction ended (server time) before the bid arrived. */
  | "AUCTION_ENDED";

export type PlaceBidResponse =
  | { accepted: true; bid: Bid; snapshot: AuctionSnapshot }
  | { accepted: false; reason: BidRejectionReason; message: string; snapshot: AuctionSnapshot };

/** Body of every non-2xx response. */
export interface ApiError {
  error: "VALIDATION_ERROR" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT";
  message: string;
  /** Per-field messages for validation errors, keyed by input field name. */
  fieldErrors?: Record<string, string[]>;
}
