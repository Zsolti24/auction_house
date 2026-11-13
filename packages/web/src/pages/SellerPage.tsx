import { useEffect, useRef } from "react";
import { formatCents, type SellerSnapshot } from "@auction/shared";
import { BidList, Countdown, CurrentBid, ItemDetails, ResultBanner } from "../components/AuctionParts";
import { CopyLink } from "../components/CopyLink";
import { Layout } from "../components/Layout";
import { Card, Notice } from "../components/ui";
import { useAuctionStream } from "../hooks/useAuctionStream";
import { useServerNow } from "../hooks/useServerNow";
import { notify } from "../notify";
import { Loading, Unavailable } from "./states";

export function SellerPage({ auctionId, sellerKey, justCreated }: { auctionId: string; sellerKey: string; justCreated: boolean }) {
  const id = encodeURIComponent(auctionId);
  const key = encodeURIComponent(sellerKey);
  const { snapshot, connection, failure, clockOffset } = useAuctionStream<SellerSnapshot>(
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
      notify.success(
        winner ? `Sold to ${winner.bidderName} for ${formatCents(winner.amountCents)}.` : "The auction ended without bids.",
        `seller-ended-${snapshot.id}`,
      );
    }
  }, [snapshot]);
}
