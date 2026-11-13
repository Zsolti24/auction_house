import { useEffect, useRef, useState, type FormEvent } from "react";
import { centsToInputValue, formatCents, parseEuroToCents, type AuctionSnapshot, type BidRejectionReason } from "@auction/shared";
import { ApiRequestError, placeBid } from "../api";
import { BidList, Countdown, CurrentBid, ItemDetails, ResultBanner } from "../components/AuctionParts";
import { Layout } from "../components/Layout";
import { NameForm } from "../components/NameForm";
import { Button, Card, Field, MoneyInput, Notice } from "../components/ui";
import { useAuctionStream } from "../hooks/useAuctionStream";
import { useServerNow } from "../hooks/useServerNow";
import { hasParticipated, markParticipated, useBidderIdentity } from "../identity";
import { flagTabTitle, flashElement, isSoundEnabled, playOutbidSound, setSoundEnabled } from "../lib/outbidCue";
import { bidderStanding, wasOutbid } from "../lib/view";
import { notify } from "../notify";
import { Loading, Unavailable } from "./states";

type Feedback = { tone: "success" | "error" | "warning"; text: string };

const REJECTION_TONE: Record<BidRejectionReason, Feedback["tone"]> = {
  TOO_LOW: "error",
  OUTBID: "warning",
  AUCTION_ENDED: "error",
};

/** Same message inline and as a toast. */
function toastFeedback(feedback: Feedback) {
  notify[feedback.tone](feedback.text);
}

export function BidderPage({ auctionId }: { auctionId: string }) {
  const { identity, setName } = useBidderIdentity();
  const { snapshot, connection, failure, clockOffset, apply } = useAuctionStream<AuctionSnapshot>(
    `/api/auctions/${encodeURIComponent(auctionId)}/events`,
    `/api/auctions/${encodeURIComponent(auctionId)}`,
  );
  const serverNow = useServerNow(clockOffset);
  const [participated, setParticipated] = useState(() => hasParticipated(auctionId));
  const livePanel = useRef<HTMLDivElement>(null);
  useLiveEventToasts(snapshot, identity.id, participated, () => {
    // The task's "sound or visual cue when you're outbid": both, plus the toast and inline notice.
    playOutbidSound();
    flashElement(livePanel.current);
    flagTabTitle();
  });

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
        <div className="min-w-0 space-y-6">
          <ItemDetails snapshot={snapshot} />
          <BidList bids={snapshot.recentBids} myId={identity.id} title="Recent bids" emptyText="No bids yet." />
        </div>

        {/* On small screens the live panel (price, countdown, bid form) comes first. */}
        <div
          ref={livePanel}
          className="order-first min-w-0 space-y-6 rounded-[28px] lg:order-none lg:sticky lg:top-24 lg:self-start"
        >
          <Card className="space-y-5">
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
                <div className="border-t border-hairline pt-5">
                  <NameForm onSubmit={setName} submitLabel="Join the auction" />
                </div>
              ))}
          </Card>
        </div>
      </div>
    </Layout>
  );
}

/**
 * Toasts for things that happen to the bidder while they watch: being outbid, and the auction
 * ending. Compared against the previous snapshot, so a page load into an already-ended auction
 * (or a reload while outbid) shows the inline state but no toast.
 */
function useLiveEventToasts(
  snapshot: AuctionSnapshot | null,
  myId: string,
  participated: boolean,
  onOutbid: () => void,
) {
  const previous = useRef<AuctionSnapshot | null>(null);
  const onOutbidRef = useRef(onOutbid);
  onOutbidRef.current = onOutbid;

  useEffect(() => {
    const prev = previous.current;
    previous.current = snapshot;
    if (!prev || !snapshot) return;

    if (wasOutbid(prev, snapshot, myId) && snapshot.highestBid) {
      notify.warning(
        `${snapshot.highestBid.bidderName} outbid you with ${formatCents(snapshot.highestBid.amountCents)}.`,
        `outbid-${snapshot.highestBid.id}`,
      );
      onOutbidRef.current();
    }

    if (prev.status === "live" && snapshot.status === "ended") {
      const winner = snapshot.highestBid;
      const standing = bidderStanding(snapshot, myId, participated);
      const id = `ended-${snapshot.id}`;
      if (standing === "won") notify.success(`You won! ${formatCents(winner!.amountCents)} is yours.`, id);
      else if (!winner) notify.info("The auction ended without bids.", id);
      else if (standing === "lost") notify.info(`Auction ended — ${winner.bidderName} won.`, id);
      else notify.info(`Auction ended — sold to ${winner.bidderName}.`, id);
    }
  }, [snapshot, myId, participated]);
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

  const show = (next: Feedback) => {
    setFeedback(next);
    toastFeedback(next);
  };

  // Keep the field pre-filled with the minimum next bid as it moves, unless the user typed their own.
  useEffect(() => {
    if (!edited) setAmount(centsToInputValue(minNext));
  }, [minNext, edited]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amountCents = parseEuroToCents(amount);
    if (amountCents === null || amountCents === 0) {
      show({ tone: "error", text: "Enter an amount like 152.50." });
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
      show(
        result.accepted
          ? { tone: "success", text: `Bid of ${formatCents(result.bid.amountCents)} accepted. You're in the lead.` }
          : { tone: REJECTION_TONE[result.reason], text: result.message },
      );
    } catch (err) {
      const fieldErrors = err instanceof ApiRequestError ? err.body?.fieldErrors : undefined;
      const text = fieldErrors ? Object.values(fieldErrors).flat().join(" ") : (err as Error).message;
      show({ tone: "error", text });
    } finally {
      setSubmitting(false);
    }
  };

  // A success message is stale once someone else takes the lead; the outbid notice says it better.
  const visibleFeedback = feedback?.tone === "success" && !leading ? null : feedback;

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-hairline pt-5">
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
      <Button type="submit" disabled={submitting} className="w-full py-3.5 text-base">
        {submitting ? "Placing bid…" : "Place bid"}
      </Button>
      {visibleFeedback && <Notice tone={visibleFeedback.tone}>{visibleFeedback.text}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-sm text-muted wrap-anywhere">
          Bidding as <span className="font-semibold text-ink">{bidderName}</span> ·{" "}
          <button type="button" onClick={onChangeName} className="text-accent hover:underline">
            change name
          </button>
        </p>
        <SoundToggle />
      </div>
    </form>
  );
}

/** On/off for the outbid chime; remembered in localStorage. */
function SoundToggle() {
  const [enabled, setEnabled] = useState(isSoundEnabled);
  return (
    <button
      type="button"
      onClick={() => {
        setSoundEnabled(!enabled);
        setEnabled(!enabled);
      }}
      aria-pressed={enabled}
      title={enabled ? "Play a sound when you're outbid" : "Outbid sound is muted"}
      className="glass-control rounded-full px-3 py-1 text-xs font-semibold text-ink/80 transition hover:bg-white/85"
    >
      {enabled ? "🔔 Sound on" : "🔕 Sound off"}
    </button>
  );
}
