import { useEffect, useRef, useState } from "react";
import { formatCents, type SellerSnapshot } from "@auction/shared";
import { endAuctionEarly } from "../api";
import { BidList, Countdown, CurrentBid, ItemDetails, ResultBanner } from "../components/AuctionParts";
import { CopyLink } from "../components/CopyLink";
import { Layout } from "../components/Layout";
import { Button, Card, Notice } from "../components/ui";
import { useAuctionStream } from "../hooks/useAuctionStream";
import { useServerNow } from "../hooks/useServerNow";
import { notify } from "../notify";
import { Loading, Unavailable } from "./states";

export function SellerPage({ auctionId, sellerKey, justCreated }: { auctionId: string; sellerKey: string; justCreated: boolean }) {
  const id = encodeURIComponent(auctionId);
  const key = encodeURIComponent(sellerKey);
  const { snapshot, connection, failure, clockOffset, apply } = useAuctionStream<SellerSnapshot>(
    `/api/auctions/${id}/seller/events?key=${key}`,
    `/api/auctions/${id}/seller?key=${key}`,
  );
  const serverNow = useServerNow(clockOffset);
  useSellerToasts(snapshot);

  if (failure) return <Unavailable message={failure} connection={connection} />;
  if (!snapshot) return <Loading connection={connection} />;

  const origin = window.location.origin;

  return (
    <Layout connection={connection}>
      {justCreated && (
        <div className="mb-6">
          <Notice tone="success">Your auction is live. Share the bidder link below — and keep the seller link to yourself.</Notice>
        </div>
      )}
      {snapshot.status === "ended" && (
        <div className="mb-6">
          <ResultBanner snapshot={snapshot} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="min-w-0 space-y-6">
          <ItemDetails snapshot={snapshot} />
          <BidList
            bids={snapshot.bids}
            title={`All bids (${snapshot.bids.length})`}
            emptyText="No bids yet. They will appear here the moment they arrive."
          />
        </div>

        <div className="order-first min-w-0 space-y-6 lg:order-none lg:sticky lg:top-24 lg:self-start">
          <Card className="space-y-5">
            <CurrentBid snapshot={snapshot} />
            <Countdown snapshot={snapshot} serverNow={serverNow} />
            {snapshot.status === "live" && (
              <EndEarly auctionId={auctionId} sellerKey={sellerKey} hasBids={snapshot.bidCount > 0} onEnded={apply} />
            )}
          </Card>
          <Card className="space-y-5">
            <CopyLink label="Bidder link" url={`${origin}/a/${id}`} hint="Share this with bidders." />
            <CopyLink
              label="Seller link"
              url={`${origin}/a/${id}/seller?key=${key}`}
              hint="Private — anyone with this link can watch the seller view."
            />
          </Card>
        </div>
      </div>
    </Layout>
  );
}

/**
 * "End auction now" — only offered before the first bid. Two steps (ask, then confirm) because it
 * can't be undone. The server re-checks everything: if a bid lands in between, it answers 409 and
 * the seller sees why.
 */
function EndEarly({
  auctionId,
  sellerKey,
  hasBids,
  onEnded,
}: {
  auctionId: string;
  sellerKey: string;
  hasBids: boolean;
  onEnded: (snapshot: SellerSnapshot) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (hasBids) {
    return (
      <p className="border-t border-hairline pt-4 text-[13px] text-muted">
        The auction has bids, so it can no longer be ended early. It closes at the end time.
      </p>
    );
  }

  const end = async () => {
    setBusy(true);
    setError(null);
    try {
      const ended = await endAuctionEarly(auctionId, sellerKey);
      onEnded(ended);
      notify.success("You ended the auction. No more bids can be placed.", `seller-ended-${auctionId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not end the auction.";
      setError(message);
      notify.error(message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-hairline pt-4">
      {error && <Notice tone="error">{error}</Notice>}
      {confirming ? (
        <>
          <p className="text-sm font-medium">End this auction now? This can't be undone.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it running
            </Button>
            <Button variant="danger" onClick={end} disabled={busy}>
              {busy ? "Ending…" : "End auction"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Button variant="secondary" className="w-full text-danger" onClick={() => setConfirming(true)}>
            End auction now
          </Button>
          <p className="text-[13px] text-muted">Possible only until the first bid arrives.</p>
        </>
      )}
    </div>
  );
}

/** Toast for every new bid while the seller watches, and for the end of the auction. */
function useSellerToasts(snapshot: SellerSnapshot | null) {
  const previous = useRef<SellerSnapshot | null>(null);
  useEffect(() => {
    const prev = previous.current;
    previous.current = snapshot;
    if (!prev || !snapshot) return;

    const newest = snapshot.bids[0];
    if (newest && newest.id !== prev.bids[0]?.id) {
      notify.info(`New bid: ${newest.bidderName} — ${formatCents(newest.amountCents)}`, `seller-bid-${newest.id}`);
    }
    if (prev.status === "live" && snapshot.status === "ended") {
      const winner = snapshot.highestBid;
      // Same toast id as the "You ended the auction" toast, so ending early shows one toast.
      notify.success(
        snapshot.endedEarly
          ? "You ended the auction. No more bids can be placed."
          : winner
            ? `Sold to ${winner.bidderName} for ${formatCents(winner.amountCents)}.`
            : "The auction ended without bids.",
        `seller-ended-${snapshot.id}`,
      );
    }
  }, [snapshot]);
}
