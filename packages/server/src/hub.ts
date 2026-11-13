import type { AuctionSnapshot, SellerSnapshot } from "@auction/shared";
import type { AuctionService } from "./auctionService";

type Subscriber =
  | { view: "public"; send: (snapshot: AuctionSnapshot) => void }
  | { view: "seller"; sellerKey: string; send: (snapshot: SellerSnapshot) => void };

/**
 * Fan-out of state changes to everyone watching an auction. Transport-agnostic: SSE routes
 * register a `send` callback. On every change each subscriber receives a full, freshly built
 * snapshot (never a diff), so a missed message can never leave a client in a wrong state.
 */
export class AuctionHub {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  constructor(private readonly service: AuctionService) {}

  subscribe(auctionId: string, subscriber: Subscriber): () => void {
    let set = this.subscribers.get(auctionId);
    if (!set) this.subscribers.set(auctionId, (set = new Set()));
    set.add(subscriber);

    return () => {
      set.delete(subscriber);
      if (set.size === 0) this.subscribers.delete(auctionId);
    };
  }

  /** Push the current state to every subscriber of the auction. */
  publish(auctionId: string): void {
    const set = this.subscribers.get(auctionId);
    if (!set) return;

    // One public snapshot shared by all bidders; seller snapshots are built per seller connection.
    let publicSnapshot: AuctionSnapshot | undefined;
    for (const subscriber of set) {
      try {
        if (subscriber.view === "public") {
          subscriber.send((publicSnapshot ??= this.service.getSnapshot(auctionId)));
        } else {
          subscriber.send(this.service.getSellerSnapshot(auctionId, subscriber.sellerKey));
        }
      } catch {
        // A broken connection must not stop delivery to the others; it unsubscribes on close.
      }
    }
  }

  subscriberCount(auctionId: string): number {
    return this.subscribers.get(auctionId)?.size ?? 0;
  }
}
