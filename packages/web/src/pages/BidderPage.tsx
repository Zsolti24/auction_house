import { useEffect, useState, type FormEvent } from "react";
import { centsToInputValue, formatCents, parseEuroToCents, type AuctionSnapshot, type BidRejectionReason } from "@auction/shared";
import { ApiRequestError, placeBid } from "../api";
import { BidList, Countdown, CurrentBid, ItemDetails, ResultBanner } from "../components/AuctionParts";
import { Layout } from "../components/Layout";
import { NameForm } from "../components/NameForm";
import { Button, Card, Field, MoneyInput, Notice } from "../components/ui";
import { useAuctionStream } from "../hooks/useAuctionStream";
import { useServerNow } from "../hooks/useServerNow";
import { hasParticipated, markParticipated, useBidderIdentity } from "../identity";
import { bidderStanding } from "../lib/view";
import { Loading, Unavailable } from "./states";

type Feedback = { tone: "success" | "error" | "warning"; text: string };

const REJECTION_TONE: Record<BidRejectionReason, Feedback["tone"]> = {
  TOO_LOW: "error",
  OUTBID: "warning",
  AUCTION_ENDED: "error",
};

export function BidderPage({ auctionId }: { auctionId: string }) {
  const { identity, setName } = useBidderIdentity();
  const { snapshot, connection, failure, clockOffset, apply } = useAuctionStream<AuctionSnapshot>(
    `/api/auctions/${encodeURIComponent(auctionId)}/events`,
    `/api/auctions/${encodeURIComponent(auctionId)}`,
  );
  const serverNow = useServerNow(clockOffset);
  const [participated, setParticipated] = useState(() => hasParticipated(auctionId));

  if (failure) return <Unavailable message={failure} connection={connection} />;
  if (!snapshot) return <Loading connection={connection} />;

  const standing = bidderStanding(snapshot, identity.id, participated);
  const ended = snapshot.status === "ended";

  return (
    <Layout connection={connection}>
      {ended && (
        <div className="mb-6">
          <ResultBanner
            snapshot={snapshot}
            personal={standing === "won" ? "won" : standing === "lost" ? "lost" : undefined}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-6">
          <ItemDetails snapshot={snapshot} />
          <BidList
            bids={snapshot.recentBids}
            myId={identity.id}
            title="Recent bids"
            emptyText="No bids yet."
          />
        </div>

        {/* On small screens the live panel (price, countdown, bid form) comes first. */}
        <div className="order-first space-y-6 lg:order-none lg:sticky lg:top-6 lg:self-start">
          <Card className="space-y-6">
            <CurrentBid snapshot={snapshot} myId={identity.id} />
            <Countdown snapshot={snapshot} serverNow={serverNow} />

            {standing === "leading" && <Notice tone="success">You're the highest bidder.</Notice>}
            {standing === "outbid" && snapshot.highestBid && (
              <Notice tone="warning">
                You've been outbid — {snapshot.highestBid.bidderName} leads with{" "}
                {formatCents(snapshot.highestBid.amountCents)}.
              </Notice>
            )}

            {!ended &&
              (identity.name ? (
                <BidForm
                  auctionId={auctionId}
                  snapshot={snapshot}
                  bidderId={identity.id}
                  bidderName={identity.name}
                  leading={standing === "leading"}
                  onResult={(next, accepted) => {
                    apply(next);
                    if (accepted) {
                      markParticipated(auctionId);
                      setParticipated(true);
                    }
                  }}
                  onChangeName={() => setName(null)}
                />
              ) : (
                <div className="border-t border-line pt-6">
                  <NameForm onSubmit={setName} submitLabel="Join the auction" />
                </div>
              ))}
          </Card>
        </div>
      </div>
    </Layout>
  );
}

function BidForm({
  auctionId,
  snapshot,
  bidderId,
  bidderName,
  leading,
  onResult,
  onChangeName,
}: {
  auctionId: string;
  snapshot: AuctionSnapshot;
  bidderId: string;
  bidderName: string;
  leading: boolean;
  onResult: (snapshot: AuctionSnapshot, accepted: boolean) => void;
  onChangeName: () => void;
}) {
  const minNext = snapshot.minNextBidCents;
  const [amount, setAmount] = useState(() => centsToInputValue(minNext));
  const [edited, setEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Keep the field pre-filled with the minimum next bid as it moves, unless the user typed their own.
  useEffect(() => {
    if (!edited) setAmount(centsToInputValue(minNext));
  }, [minNext, edited]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amountCents = parseEuroToCents(amount);
    if (amountCents === null || amountCents === 0) {
      setFeedback({ tone: "error", text: "Enter an amount like 152.50." });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await placeBid(auctionId, {
        bidderId,
        bidderName,
        amountCents,
        // The leader this bidder saw: lets the server say "outbid in the meantime" vs "too low".
        expectedLeadingBidId: snapshot.highestBid?.id ?? null,
      });
      onResult(result.snapshot, result.accepted);
      setEdited(false);
      setAmount(centsToInputValue(result.snapshot.minNextBidCents));
      setFeedback(
        result.accepted
          ? { tone: "success", text: `Bid of ${formatCents(result.bid.amountCents)} accepted.` }
          : { tone: REJECTION_TONE[result.reason], text: result.message },
      );
    } catch (err) {
      const fieldErrors = err instanceof ApiRequestError ? err.body?.fieldErrors : undefined;
      const text = fieldErrors ? Object.values(fieldErrors).flat().join(" ") : (err as Error).message;
      setFeedback({ tone: "error", text });
    } finally {
      setSubmitting(false);
    }
  };

  // A success message is stale once someone else takes the lead; the outbid notice says it better.
  const visibleFeedback = feedback?.tone === "success" && !leading ? null : feedback;

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-line pt-6">
      <Field label={`Your bid (minimum ${formatCents(minNext)})`}>
        <MoneyInput
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setEdited(true);
          }}
          aria-label="Bid amount in euros"
        />
      </Field>
      <Button type="submit" disabled={submitting} className="w-full text-base">
        {submitting ? "Placing bid…" : "Place bid"}
      </Button>
      {visibleFeedback && <Notice tone={visibleFeedback.tone}>{visibleFeedback.text}</Notice>}
      <p className="text-sm text-muted">
        Bidding as <span className="font-semibold text-ink">{bidderName}</span> ·{" "}
        <button type="button" onClick={onChangeName} className="underline underline-offset-2 hover:text-ink">
          change name
        </button>
      </p>
    </form>
  );
}
