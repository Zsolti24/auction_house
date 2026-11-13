import { useEffect, useRef, useState } from "react";
import { formatCents, type AuctionSnapshot, type Bid } from "@auction/shared";
import { formatClockTime, formatRemaining } from "../lib/view";
import { Card, cx, Eyebrow } from "./ui";

/*
 * All user-provided text (title, description, names) uses `wrap-anywhere`, so a long word or a
 * pasted URL breaks onto the next line instead of pushing the page wider than the screen.
 */

export function ItemDetails({ snapshot }: { snapshot: AuctionSnapshot }) {
  return (
    <Card>
      <Eyebrow>{snapshot.status === "live" ? "Live auction" : "Auction closed"}</Eyebrow>
      <h1 className="mt-1 text-3xl font-bold tracking-tight wrap-anywhere sm:text-[34px] sm:leading-tight">
        {snapshot.title}
      </h1>
      {snapshot.sellerName && <p className="mt-1 text-sm text-muted wrap-anywhere">Offered by {snapshot.sellerName}</p>}
      <p className="mt-4 whitespace-pre-line leading-relaxed text-ink/80 wrap-anywhere">{snapshot.description}</p>
      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <div className="glass-control rounded-2xl px-4 py-3">
          <dt className="text-muted">Starting price</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{formatCents(snapshot.startingPriceCents)}</dd>
        </div>
        <div className="glass-control rounded-2xl px-4 py-3">
          <dt className="text-muted">Minimum increment</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{formatCents(snapshot.minIncrementCents)}</dd>
        </div>
      </dl>
    </Card>
  );
}

/** Current price + leader, as big as it deserves to be. */
export function CurrentBid({ snapshot, myId }: { snapshot: AuctionSnapshot; myId?: string }) {
  const bid = snapshot.highestBid;
  const ended = snapshot.status === "ended";
  return (
    <div>
      <Eyebrow>{ended ? (bid ? "Winning bid" : "Result") : bid ? "Current bid" : "Opening bid"}</Eyebrow>
      <p className="mt-0.5 text-[52px] font-bold leading-none tracking-tight tabular-nums">
        {formatCents(bid?.amountCents ?? snapshot.startingPriceCents)}
      </p>
      <p className="mt-2 text-sm text-muted wrap-anywhere">
        {bid ? (
          <>
            by <span className="font-semibold text-ink">{bid.bidderName}</span>
            {myId && bid.bidderId === myId && " (you)"} · {snapshot.bidCount} {snapshot.bidCount === 1 ? "bid" : "bids"}
          </>
        ) : ended ? (
          "No bids were placed"
        ) : (
          "No bids yet — be the first"
        )}
      </p>
    </div>
  );
}

/**
 * Countdown against the server clock. When local time reaches zero but the server has not
 * confirmed the end yet, shows "Closing…" — the client never declares the auction over itself.
 */
export function Countdown({ snapshot, serverNow }: { snapshot: AuctionSnapshot; serverNow: number }) {
  const remaining = snapshot.endsAt - serverNow;
  const extended = useExtensionFlash(snapshot.endsAt, snapshot.status === "live");

  if (snapshot.status === "ended") {
    return (
      <div className="glass-control rounded-2xl px-4 py-3">
        <Eyebrow>Auction</Eyebrow>
        <p className="text-2xl font-bold tracking-tight">{snapshot.endedEarly ? "Ended early" : "Ended"}</p>
        <p className="text-sm text-muted">
          {snapshot.endedEarly ? "by the seller at " : "at "}
          {formatClockTime(snapshot.endsAt)}
        </p>
      </div>
    );
  }

  const urgent = remaining <= 30_000;
  return (
    <div className={cx("glass-control rounded-2xl px-4 py-3 transition", urgent && "bg-danger-soft")}>
      <Eyebrow>Time remaining</Eyebrow>
      <p className={cx("text-3xl font-bold tracking-tight tabular-nums", urgent && "text-danger")} aria-live="off">
        {remaining > 0 ? formatRemaining(remaining) : "Closing…"}
      </p>
      <p className="text-sm text-muted">
        Ends at {formatClockTime(snapshot.endsAt)}
        {extended && <span className="ml-2 font-semibold text-warning">Extended by a late bid</span>}
      </p>
    </div>
  );
}

/** True for a few seconds after the end time moved forward (anti-sniping), for a visual hint. */
function useExtensionFlash(endsAt: number, live: boolean): boolean {
  const previous = useRef(endsAt);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (live && endsAt > previous.current) {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 5_000);
      previous.current = endsAt;
      return () => clearTimeout(timer);
    }
    previous.current = endsAt;
  }, [endsAt, live]);
  return flash;
}

export function BidList({ bids, myId, title, emptyText }: { bids: Bid[]; myId?: string; title: string; emptyText: string }) {
  return (
    <Card>
      <h2 className="text-xl font-bold tracking-tight">{title}</h2>
      {bids.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{emptyText}</p>
      ) : (
        <ol className="mt-3 divide-y divide-hairline">
          {bids.map((bid, i) => (
            <li key={bid.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <span className="min-w-0 wrap-anywhere">
                <span className={cx("font-semibold", i === 0 && "text-accent")}>{bid.bidderName}</span>
                {myId && bid.bidderId === myId && <span className="ml-1.5 text-muted">(you)</span>}
                <span className="ml-2 text-muted tabular-nums">{formatClockTime(bid.createdAt)}</span>
              </span>
              <span className={cx("shrink-0 font-semibold tabular-nums", i === 0 && "text-accent")}>
                {formatCents(bid.amountCents)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** "Sold to Anna for €152.50" / "Ended without bids", plus a personal line for bidders. */
export function ResultBanner({ snapshot, personal }: { snapshot: AuctionSnapshot; personal?: "won" | "lost" }) {
  const winner = snapshot.highestBid;
  return (
    <div
      className={cx(
        "glass rounded-[28px] p-6 text-center wrap-anywhere",
        personal === "won" && "bg-success-soft",
      )}
    >
      {personal === "won" && <p className="text-4xl font-bold tracking-tight text-success">You won</p>}
      {personal === "lost" && <p className="text-3xl font-bold tracking-tight">You lost</p>}
      <p className={cx("font-bold tracking-tight", personal ? "mt-1 text-lg text-ink/80" : "text-3xl")}>
        {winner ? `Sold to ${winner.bidderName} for ${formatCents(winner.amountCents)}` : "Ended without bids"}
      </p>
      {snapshot.endedEarly && <p className="mt-1 text-sm text-muted">The seller ended the auction early.</p>}
    </div>
  );
}
