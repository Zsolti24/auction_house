import { formatCents, type AuctionSummary } from "@auction/shared";
import { Layout } from "../components/Layout";
import { Button, Card, cx, Eyebrow } from "../components/ui";
import { useLiveAuctions } from "../hooks/useAuctionStream";
import { useServerNow } from "../hooks/useServerNow";
import { useBidderIdentity } from "../identity";
import { formatRemaining } from "../lib/view";
import { Link, navigate } from "../router";

/** Live list of running auctions. Updates itself when auctions are created, bid on or end. */
export function LobbyPage() {
  const { identity } = useBidderIdentity();
  const { list, connection, clockOffset } = useLiveAuctions();
  const serverNow = useServerNow(clockOffset, 500);

  return (
    <Layout connection={connection}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Hi {identity.name}</Eyebrow>
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">Live auctions</h1>
          <p className="mt-2 text-muted">Pick one to start bidding. This list updates by itself.</p>
        </div>
        <Button variant="secondary" onClick={() => navigate("/create")}>
          Create an auction
        </Button>
      </div>

      <div className="mt-8">
        {!list ? (
          <p className="py-16 text-center text-muted">Loading auctions…</p>
        ) : list.auctions.length === 0 ? (
          <Card className="py-12 text-center">
            <p className="font-display text-2xl font-bold">No live auctions right now</p>
            <p className="mt-2 text-muted">New auctions will appear here the moment they start.</p>
            <Button className="mt-6" onClick={() => navigate("/create")}>
              Create the first one
            </Button>
          </Card>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {list.auctions.map((auction) => (
              <li key={auction.id}>
                <AuctionCard auction={auction} serverNow={serverNow} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Layout>
  );
}

function AuctionCard({ auction, serverNow }: { auction: AuctionSummary; serverNow: number }) {
  const remaining = auction.endsAt - serverNow;
  const urgent = remaining <= 30_000;

  return (
    <Link
      href={`/a/${encodeURIComponent(auction.id)}`}
      className="group block h-full rounded-2xl border border-line bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-xl font-bold leading-snug group-hover:text-accent">{auction.title}</h2>
        <span className={cx("shrink-0 font-display text-lg font-bold tabular-nums", urgent && "text-accent")}>
          {remaining > 0 ? formatRemaining(remaining) : "Closing…"}
        </span>
      </div>
      {auction.sellerName && <p className="mt-1 text-sm text-muted">Offered by {auction.sellerName}</p>}
      <div className="mt-5 flex items-end justify-between gap-3 border-t border-line pt-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            {auction.bidCount > 0 ? "Current bid" : "Starting at"}
          </p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums">{formatCents(auction.currentPriceCents)}</p>
        </div>
        <p className="text-sm text-muted">
          {auction.bidCount} {auction.bidCount === 1 ? "bid" : "bids"}
        </p>
      </div>
    </Link>
  );
}
