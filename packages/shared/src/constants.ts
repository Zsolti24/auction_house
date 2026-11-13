/** A bid accepted within this window before the end pushes the end to `bidTime + window`. */
export const ANTI_SNIPING_WINDOW_MS = 30_000;

/** How many of the latest bids the public (bidder) snapshot includes. The seller sees all. */
export const RECENT_BIDS_LIMIT = 10;

/** Maximum number of auctions in the live-auctions list. */
export const LIVE_AUCTIONS_LIMIT = 100;

/** Upper bound for any money amount: €1,000,000,000.00. Keeps values far from float precision limits. */
export const MAX_AMOUNT_CENTS = 100_000_000_000;
