import type { Bid } from "@auction/shared";
import type { Db } from "./db";

export interface AuctionRow {
  id: string;
  sellerKeyHash: string;
  title: string;
  description: string;
  startingPriceCents: number;
  minIncrementCents: number;
  createdAt: number;
  endsAt: number;
}

const AUCTION_COLUMNS = `
  id, seller_key_hash AS sellerKeyHash, title, description,
  starting_price_cents AS startingPriceCents, min_increment_cents AS minIncrementCents,
  created_at AS createdAt, ends_at AS endsAt`;

const BID_COLUMNS = `
  id, bidder_id AS bidderId, bidder_name AS bidderName,
  amount_cents AS amountCents, created_at AS createdAt`;

/** Thin data access layer: prepared statements only, no business rules. */
export class AuctionRepository {
  private readonly stmts;

  constructor(db: Db) {
    this.stmts = {
      insertAuction: db.prepare<AuctionRow>(`
        INSERT INTO auctions (id, seller_key_hash, title, description, starting_price_cents,
                              min_increment_cents, created_at, ends_at)
        VALUES (@id, @sellerKeyHash, @title, @description, @startingPriceCents,
                @minIncrementCents, @createdAt, @endsAt)`),
      getAuction: db.prepare<[string], AuctionRow>(`SELECT ${AUCTION_COLUMNS} FROM auctions WHERE id = ?`),
      updateEndsAt: db.prepare<[number, string]>(`UPDATE auctions SET ends_at = ? WHERE id = ?`),
      liveAuctions: db.prepare<[number], AuctionRow>(
        `SELECT ${AUCTION_COLUMNS} FROM auctions WHERE ends_at > ? ORDER BY ends_at`,
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
