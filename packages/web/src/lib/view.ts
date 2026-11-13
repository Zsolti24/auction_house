import type { AuctionSnapshot } from "@auction/shared";

/**
 * Pure view logic, kept out of components so it can be unit-tested.
 * The client never decides anything about the auction — it only interprets server snapshots.
 */

/**
 * Snapshots arrive from two sources (SSE pushes and bid responses) and may overtake each other.
 * Keep the one the server produced last.
 */
export function pickNewer<T extends AuctionSnapshot>(current: T | null, incoming: T): T {
  if (!current) return incoming;
  if (incoming.serverTime !== current.serverTime) return incoming.serverTime > current.serverTime ? incoming : current;
  return incoming.bidCount >= current.bidCount ? incoming : current;
}

export type BidderStanding = "leading" | "outbid" | "won" | "lost" | "watching";

/**
 * Where this bidder stands. `participated` covers bids that already scrolled out of the
 * recent-bids list (remembered in localStorage).
 */
export function bidderStanding(snapshot: AuctionSnapshot, myId: string, participated: boolean): BidderStanding {
  const leading = snapshot.highestBid?.bidderId === myId;
  const hasBid = participated || snapshot.recentBids.some((b) => b.bidderId === myId);
  if (snapshot.status === "ended") {
    if (leading) return "won";
    return hasBid ? "lost" : "watching";
  }
  if (leading) return "leading";
  return hasBid ? "outbid" : "watching";
}

/** 0:42, 4:05, 1:02:03, 2d 4h 10m. Rounds up so "0:00" only shows once time is really up. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "0:00";
  const total = Math.ceil(ms / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

export function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
