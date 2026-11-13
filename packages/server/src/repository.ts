import type { AuctionSummary, Bid } from "@auction/shared";
import type { Db } from "./db";

export interface AuctionRow {
  id: string;
  sellerKeyHash: string;
  sellerName: string;
  title: string;
  description: string;
  startingPriceCents: number;
  minIncrementCents: number;
  createdAt: number;
  endsAt: number;
}

const AUCTION_COLUMNS = `
  id, seller_key_hash AS sellerKeyHash, seller_name AS sellerName, title, description,
  starting_price_cents AS startingPriceCents, min_increment_cents AS minIncrementCents,
  created_at AS createdAt, ends_at AS endsAt`;

const BID_COLUMNS = `
  id, bidder_id AS bidderId, bidder_name AS bidderName,
  amount_cents AS amountCents, created_at AS createdAt`;

/**
 * One row per auction for the lobby lists. Every accepted bid beats the previous one, so
 * MAX(amount) is the leading (or winning) bid, and its bidder is the leader (or winner).
 * "Ended" is decided by the caller's WHERE on ends_at vs. now, like everywhere else.
 */
const SUMMARY_SELECT = `
  SELECT a.id, a.title, a.seller_name AS sellerName, a.ends_at AS endsAt,
         COALESCE(MAX(b.amount_cents), a.starting_price_cents) AS currentPriceCents,
         COUNT(b.seq) AS bidCount,
         (SELECT lb.bidder_name FROM bids lb WHERE lb.auction_id = a.id
          ORDER BY lb.amount_cents DESC, lb.seq DESC LIMIT 1) AS leaderName
  FROM auctions a
  LEFT JOIN bids b ON b.auction_id = a.id`;

/** Thin data access layer: prepared statements only, no business rules. */
export class AuctionRepository {
  private readonly stmts;

  constructor(db: Db) {
    this.stmts = {
      insertAuction: db.prepare<AuctionRow>(`
        INSERT INTO auctions (id, seller_key_hash, seller_name, title, description, starting_price_cents,
                              min_increment_cents, created_at, ends_at)
        VALUES (@id, @sellerKeyHash, @sellerName, @title, @description, @startingPriceCents,
                @minIncrementCents, @createdAt, @endsAt)`),
      getAuction: db.prepare<[string], AuctionRow>(`SELECT ${AUCTION_COLUMNS} FROM auctions WHERE id = ?`),
      updateEndsAt: db.prepare<[number, string]>(`UPDATE auctions SET ends_at = ? WHERE id = ?`),
      liveAuctions: db.prepare<[number], AuctionRow>(
        `SELECT ${AUCTION_COLUMNS} FROM auctions WHERE ends_at > ? ORDER BY ends_at`,
      ),
      liveSummaries: db.prepare<[number, number], AuctionSummary>(
        `${SUMMARY_SELECT} WHERE a.ends_at > ? GROUP BY a.id ORDER BY a.ends_at, a.id LIMIT ?`,
      ),
      endedSummaries: db.prepare<[number, number], AuctionSummary>(
        `${SUMMARY_SELECT} WHERE a.ends_at <= ? GROUP BY a.id ORDER BY a.ends_at DESC, a.id LIMIT ?`,
      ),

      insertBid: db.prepare<Bid & { auctionId: string }>(`
        INSERT INTO bids (id, auction_id, bidder_id, bidder_name, amount_cents, created_at)
        VALUES (@id, @auctionId, @bidderId, @bidderName, @amountCents, @createdAt)`),
      highestBid: db.prepare<[string], Bid>(
        `SELECT ${BID_COLUMNS} FROM bids WHERE auction_id = ? ORDER BY amount_cents DESC, seq DESC LIMIT 1`,
      ),
      getBid: db.prepare<[string, string], Bid>(`SELECT ${BID_COLUMNS} FROM bids WHERE auction_id = ? AND id = ?`),
      bidsNewestFirst: db.prepare<[string, number], Bid>(
        `SELECT ${BID_COLUMNS} FROM bids WHERE auction_id = ? ORDER BY seq DESC LIMIT ?`,
      ),
      countBids: db.prepare<[string], { count: number }>(`SELECT COUNT(*) AS count FROM bids WHERE auction_id = ?`),
    };
  }

  insertAuction(row: AuctionRow): void {
    this.stmts.insertAuction.run(row);
  }

  getAuction(id: string): AuctionRow | undefined {
    return this.stmts.getAuction.get(id);
  }

  updateEndsAt(id: string, endsAt: number): void {
    this.stmts.updateEndsAt.run(endsAt, id);
  }

  liveAuctions(now: number): AuctionRow[] {
    return this.stmts.liveAuctions.all(now);
  }

  liveSummaries(now: number, limit: number): AuctionSummary[] {
    return this.stmts.liveSummaries.all(now, limit);
  }

  endedSummaries(now: number, limit: number): AuctionSummary[] {
    return this.stmts.endedSummaries.all(now, limit);
  }

  insertBid(auctionId: string, bid: Bid): void {
    this.stmts.insertBid.run({ ...bid, auctionId });
  }

  highestBid(auctionId: string): Bid | undefined {
    return this.stmts.highestBid.get(auctionId);
  }

  getBid(auctionId: string, bidId: string): Bid | undefined {
    return this.stmts.getBid.get(auctionId, bidId);
  }

  /** Newest first. `limit = -1` returns all (SQLite treats a negative LIMIT as no limit). */
  bids(auctionId: string, limit = -1): Bid[] {
    return this.stmts.bidsNewestFirst.all(auctionId, limit);
  }

  countBids(auctionId: string): number {
    return this.stmts.countBids.get(auctionId)!.count;
  }
}
