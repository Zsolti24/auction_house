import { formatCents, type AuctionSummary } from "@auction/shared";
import { Layout } from "../components/Layout";
import { Button, Card, cx, Eyebrow } from "../components/ui";
import { useAuctionList } from "../hooks/useAuctionStream";
import { useServerNow } from "../hooks/useServerNow";
import { useBidderIdentity } from "../identity";
import { formatClockTime, formatRemaining } from "../lib/view";
import { Link, navigate } from "../router";

/**
 * Auction list: running auctions first (ending soonest first), ended ones below (most recently
 * ended first). Updates itself when auctions are created, bid on or end — an auction that ends
 * moves from the top list to the bottom one for everyone at the same moment.
 */
export function LobbyPage() {
  const { identity } = useBidderIdentity();
  const { list, connection, clockOffset } = useAuctionList();
  const serverNow = useServerNow(clockOffset, 500);

  return (
    <Layout connection={connection}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Eyebrow>Hi {identity.name}</Eyebrow>
          <h1 className="mt-1 text-4xl font-bold tracking-tight">Live auctions</h1>
          <p className="mt-2 text-muted">Pick one to start bidding. This list updates by itself.</p>
        </div>
        <Button variant="secondary" onClick={() => navigate("/create")}>
          Create an auction
        </Button>
      </div>

      {!list ? (
        <div className="flex justify-center py-20">
          <span className="size-8 animate-spin rounded-full border-[3px] border-accent/20 border-t-accent" aria-label="Loading" />
        </div>
      ) : (
        <>
          <section className="mt-8" aria-label="Running auctions">
            {list.live.length === 0 ? (
              <Card className="py-14 text-center">
                <p className="text-2xl font-bold tracking-tight">No live auctions right now</p>
                <p className="mt-2 text-muted">New auctions will appear here the moment they start.</p>
                <Button className="mt-6" onClick={() => navigate("/create")}>
                  Create the first one
                </Button>
              </Card>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {list.live.map((auction) => (
                  <li key={auction.id} className="min-w-0">
                    <LiveCard auction={auction} serverNow={serverNow} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {list.ended.length > 0 && (
            <section className="mt-12" aria-label="Ended auctions">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-2xl font-bold tracking-tight">Ended</h2>
                <p className="text-sm text-muted">Most recent first</p>
              </div>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {list.ended.map((auction) => (
                  <li key={auction.id} className="min-w-0">
                    <EndedCard auction={auction} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Layout>
  );
}

const cardLink = "group block h-full rounded-[28px] transition hover:-translate-y-0.5 active:scale-[0.99]";

function LiveCard({ auction, serverNow }: { auction: AuctionSummary; serverNow: number }) {
  const remaining = auction.endsAt - serverNow;
  const urgent = remaining <= 30_000;

  return (
    <Link href={`/a/${encodeURIComponent(auction.id)}`} className={cx(cardLink, "glass p-5 hover:bg-white/70")}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-lg font-bold leading-snug tracking-tight wrap-anywhere group-hover:text-accent">
          {auction.title}
        </h3>
        <span
          className={cx(
            "glass-control shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums",
            urgent && "bg-danger-soft text-danger",
          )}
        >
          {remaining > 0 ? formatRemaining(remaining) : "Closing…"}
        </span>
      </div>
      {auction.sellerName && <p className="mt-1 text-sm text-muted wrap-anywhere">Offered by {auction.sellerName}</p>}
      <div className="mt-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-muted">{auction.bidCount > 0 ? "Current bid" : "Starting at"}</p>
          <p className="text-2xl font-bold tracking-tight tabular-nums">{formatCents(auction.currentPriceCents)}</p>
        </div>
        <p className="min-w-0 text-right text-sm text-muted wrap-anywhere">
          {auction.leaderName ? (
            <>
              <span className="font-semibold text-ink">{auction.leaderName}</span> leads · {auction.bidCount}{" "}
              {auction.bidCount === 1 ? "bid" : "bids"}
            </>
          ) : (
            "No bids yet"
          )}
        </p>
      </div>
    </Link>
  );
}

/** Quieter card for a finished auction: the result instead of a countdown. Still opens the auction. */
function EndedCard({ auction }: { auction: AuctionSummary }) {
  return (
    <Link
      href={`/a/${encodeURIComponent(auction.id)}`}
      className={cx(cardLink, "glass-control bg-white/35 p-4 hover:bg-white/60")}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 font-semibold leading-snug text-ink/80 wrap-anywhere group-hover:text-accent">
          {auction.title}
        </h3>
        <span className="shrink-0 rounded-full bg-ink/5 px-2.5 py-0.5 text-xs font-semibold text-muted">Ended</span>
      </div>
      <p className="mt-2 text-sm wrap-anywhere">
        {auction.leaderName ? (
          <>
            Sold to <span className="font-semibold">{auction.leaderName}</span> for{" "}
            <span className="font-semibold tabular-nums">{formatCents(auction.currentPriceCents)}</span>
          </>
        ) : (
          <span className="text-muted">Ended without bids</span>
        )}
      </p>
      <p className="mt-1 text-xs text-muted">
        {auction.sellerName && <span className="wrap-anywhere">Offered by {auction.sellerName} · </span>}
        ended at {formatClockTime(auction.endsAt)}
      </p>
    </Link>
  );
}
