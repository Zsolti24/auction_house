import type { Clock } from "./clock";

/** setTimeout fires immediately for delays above 2^31-1 ms (~24.8 days); longer waits are chained. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * One timer per live auction that pushes the "ended" state to watchers at the end time.
 *
 * Correctness never depends on these timers: every request derives "ended" from the clock.
 * The timers only make sure clients are told without having to ask. They live in memory and
 * are rebuilt from the database on startup.
 */
export class EndTimers {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly clock: Clock,
    /** Current end time from the database (it may have been extended), undefined if unknown. */
    private readonly currentEndsAt: (auctionId: string) => number | undefined,
    private readonly onEnded: (auctionId: string) => void,
  ) {}

  /** (Re)schedule the end notification; replaces any existing timer for the auction. */
  schedule(auctionId: string, endsAt: number): void {
    this.cancel(auctionId);
    const delay = Math.min(Math.max(endsAt - this.clock.now(), 0), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => this.fire(auctionId), delay);
    timer.unref(); // never keep the process alive just for a pending end notification
    this.timers.set(auctionId, timer);
  }

  cancel(auctionId: string): void {
    clearTimeout(this.timers.get(auctionId));
    this.timers.delete(auctionId);
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  get size(): number {
    return this.timers.size;
  }

  private fire(auctionId: string): void {
    this.timers.delete(auctionId);
    const endsAt = this.currentEndsAt(auctionId);
    if (endsAt === undefined) return;

    // Timers can fire a little early, and long waits are chained: re-check against the clock.
    if (this.clock.now() >= endsAt) this.onEnded(auctionId);
    else this.schedule(auctionId, endsAt);
  }
}
