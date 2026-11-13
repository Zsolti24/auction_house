import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { CreateAuctionInput } from "@auction/shared";
import { AuctionService } from "../src/auctionService";
import type { Clock } from "../src/clock";
import { openDatabase, type Db } from "../src/db";
import { HttpError } from "../src/errors";

/** Fixed start time so failures are reproducible. */
export const T0 = Date.UTC(2026, 10, 13, 12, 0, 0);

export class FakeClock implements Clock {
  constructor(public time = T0) {}
  now() {
    return this.time;
  }
  advance(ms: number) {
    this.time += ms;
  }
  set(time: number) {
    this.time = time;
  }
}

/**
 * Real time plus an adjustable offset. For tests that need real timers to fire (end
 * notifications) but must not wait the full duration: `jump()` skips ahead instantly.
 */
export class ShiftedClock implements Clock {
  private offset = 0;
  now() {
    return Date.now() + this.offset;
  }
  jump(ms: number) {
    this.offset += ms;
  }
}

export function makeService(dbPath = ":memory:", clock = new FakeClock()) {
  const db: Db = openDatabase(dbPath);
  return { db, clock, service: new AuctionService(db, clock) };
}

export function auctionInput(overrides: Partial<CreateAuctionInput> = {}): CreateAuctionInput {
  return {
    title: "Leica M3",
    sellerName: "Sam",
    description: "1956 rangefinder, working condition",
    startingPriceCents: 10_000, // €100.00
    minIncrementCents: 500, // €5.00
    endsAt: T0 + 10 * 60_000,
    ...overrides,
  };
}

/** A bidder with a stable id, mirroring the browser's localStorage identity. */
export function bidder(name: string) {
  return { bidderId: randomUUID(), bidderName: name };
}

export function expectHttpError(fn: () => unknown, statusCode: number): HttpError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(statusCode);
    return err as HttpError;
  }
  throw new Error(`Expected HttpError ${statusCode}, but nothing was thrown`);
}
