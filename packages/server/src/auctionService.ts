import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  createAuctionInputSchema,
  formatCents,
  placeBidInputSchema,
  RECENT_BIDS_LIMIT,
  type AuctionSnapshot,
  type Bid,
  type BidRejectionReason,
  type CreateAuctionResponse,
  type PlaceBidResponse,
  type SellerSnapshot,
} from "@auction/shared";
import type { Clock } from "./clock";
import type { Db } from "./db";
import { deriveStatus, evaluateBid, minNextBid } from "./domain";
import { forbidden, notFound, validationError } from "./errors";
import { AuctionRepository, type AuctionRow } from "./repository";

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export class AuctionService {
  private readonly repo: AuctionRepository;

  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {
    this.repo = new AuctionRepository(db);
  }

  createAuction(body: unknown): CreateAuctionResponse {
    const now = this.clock.now();
    const parsed = createAuctionInputSchema(now).safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);

    const id = randomBytes(9).toString("base64url"); // 12 URL-safe chars
    const sellerKey = randomBytes(24).toString("base64url");
    // Only the hash is stored: a leaked DB file does not leak seller links.
    this.repo.insertAuction({ id, sellerKeyHash: hashKey(sellerKey), createdAt: now, ...parsed.data });
    return { id, sellerKey };
  }

  getSnapshot(auctionId: string): AuctionSnapshot {
    const auction = this.repo.getAuction(auctionId);
    if (!auction) throw notFound();
    return this.buildSnapshot(auction, this.clock.now());
  }

  getSellerSnapshot(auctionId: string, sellerKey: string): SellerSnapshot {
    const auction = this.repo.getAuction(auctionId);
    if (!auction) throw notFound();
    const given = Buffer.from(hashKey(sellerKey));
    const expected = Buffer.from(auction.sellerKeyHash);
    if (!timingSafeEqual(given, expected)) throw forbidden();
    return { ...this.buildSnapshot(auction, this.clock.now()), bids: this.repo.bids(auctionId) };
  }

  /**
   * The whole read → decide → write sequence runs inside one synchronous SQLite transaction
   * (BEGIN IMMEDIATE). better-sqlite3 is synchronous and Node is single-threaded, so no other
   * request can interleave between reading the leader and inserting the new bid: two
   * "simultaneous" bids are always decided one after the other against fresh state.
   * Do not add any `await` inside the transaction function.
   */
  placeBid(auctionId: string, body: unknown): PlaceBidResponse {
    const parsed = placeBidInputSchema.safeParse(body);
    if (!parsed.success) throw validationError(parsed.error);
    const input = parsed.data;

    const run = this.db.transaction((): PlaceBidResponse => {
      const auction = this.repo.getAuction(auctionId);
      if (!auction) throw notFound();

      // Read the clock inside the transaction: this is the moment the bid "arrives".
      const now = this.clock.now();
      const leader = this.repo.highestBid(auctionId) ?? null;
      const minNextCents = minNextBid(auction.startingPriceCents, auction.minIncrementCents, leader?.amountCents ?? null);

      const decision = evaluateBid({
        now,
        endsAt: auction.endsAt,
        amountCents: input.amountCents,
        minNextCents,
        leadingBidId: leader?.id ?? null,
        expectedLeadingBidId: input.expectedLeadingBidId,
        minNextAsSeenCents: this.minNextAsSeen(auction, input.expectedLeadingBidId),
      });

      if (!decision.accepted) {
        const snapshot = this.buildSnapshot(auction, now);
        return {
          accepted: false,
          reason: decision.reason,
          message: rejectionMessage(decision.reason, snapshot.minNextBidCents),
          snapshot,
        };
      }

      const bid: Bid = {
        id: randomUUID(),
        bidderId: input.bidderId,
        bidderName: input.bidderName,
        amountCents: input.amountCents,
        createdAt: now,
      };
      this.repo.insertBid(auctionId, bid);
      if (decision.newEndsAt !== auction.endsAt) this.repo.updateEndsAt(auctionId, decision.newEndsAt);

      return { accepted: true, bid, snapshot: this.buildSnapshot({ ...auction, endsAt: decision.newEndsAt }, now) };
    });

    return run.immediate();
  }

  /** Auctions still running at `now` — used to rebuild end timers after a restart. */
  liveAuctions(): AuctionRow[] {
    return this.repo.liveAuctions(this.clock.now());
  }

  /** The minimum next bid in the state the bidder saw. Unknown bid id → Infinity (never OUTBID). */
  private minNextAsSeen(auction: AuctionRow, expectedLeadingBidId: string | null): number {
    if (expectedLeadingBidId === null) return auction.startingPriceCents;
    const seen = this.repo.getBid(auction.id, expectedLeadingBidId);
    return seen ? seen.amountCents + auction.minIncrementCents : Number.POSITIVE_INFINITY;
  }

  private buildSnapshot(auction: AuctionRow, now: number): AuctionSnapshot {
    const highestBid = this.repo.highestBid(auction.id) ?? null;
    return {
      id: auction.id,
      title: auction.title,
      description: auction.description,
      startingPriceCents: auction.startingPriceCents,
      minIncrementCents: auction.minIncrementCents,
      createdAt: auction.createdAt,
      endsAt: auction.endsAt,
      status: deriveStatus(auction.endsAt, now),
      highestBid,
      minNextBidCents: minNextBid(auction.startingPriceCents, auction.minIncrementCents, highestBid?.amountCents ?? null),
      bidCount: this.repo.countBids(auction.id),
      recentBids: this.repo.bids(auction.id, RECENT_BIDS_LIMIT),
      serverTime: now,
    };
  }
}

function rejectionMessage(reason: BidRejectionReason, minNextCents: number): string {
  switch (reason) {
    case "TOO_LOW":
      return `Your bid is too low. The minimum bid is ${formatCents(minNextCents)}.`;
    case "OUTBID":
      return `Someone else bid in the meantime. The minimum bid is now ${formatCents(minNextCents)}.`;
    case "AUCTION_ENDED":
      return "The auction has already ended.";
  }
}
