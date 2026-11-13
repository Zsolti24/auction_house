import type { AuctionSnapshot, AuctionListSnapshot, SellerSnapshot } from "@auction/shared";
import type { AuctionService } from "./auctionService";

type Subscriber =
  | { view: "public"; send: (snapshot: AuctionSnapshot) => void }
  | { view: "seller"; sellerKey: string; send: (snapshot: SellerSnapshot) => void };

type LobbySubscriber = (snapshot: AuctionListSnapshot) => void;

/**
 * Fan-out of state changes to everyone watching. Transport-agnostic: SSE routes register a
 * `send` callback. On every change each subscriber receives a full, freshly built snapshot
 * (never a diff), so a missed message can never leave a client in a wrong state.
 *
 * Two kinds of watchers: people on one auction's page, and people on the auction list
 * ("lobby"), which changes whenever any auction is created, gets a bid or ends.
 */
export class AuctionHub {
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly lobby = new Set<LobbySubscriber>();

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

  subscribeLobby(send: LobbySubscriber): () => void {
    this.lobby.add(send);
    return () => this.lobby.delete(send);
  }

  /** Push the current state of one auction to its watchers, and the updated list to the lobby. */
  publish(auctionId: string): void {
    const set = this.subscribers.get(auctionId);
    if (set) {
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
    this.publishLobby();
  }

  /** Push the auction list to everyone on the list page. */
  publishLobby(): void {
    if (this.lobby.size === 0) return;
    const snapshot = this.service.getAuctionList();
    for (const send of this.lobby) {
      try {
        send(snapshot);
      } catch {
        // see above
      }
    }
  }

  subscriberCount(auctionId: string): number {
    return this.subscribers.get(auctionId)?.size ?? 0;
  }
}
