import { useState, type FormEvent } from "react";
import { createAuctionInputSchema, parseEuroToCents, toFieldErrors } from "@auction/shared";
import { ApiRequestError, createAuction } from "../api";
import { Layout } from "../components/Layout";
import { Button, Card, Eyebrow, Field, MoneyInput, Notice, TextArea, TextInput } from "../components/ui";
import { useBidderIdentity } from "../identity";
import { notify } from "../notify";
import { Link, navigate } from "../router";

type Errors = Record<string, string[]>;

const DURATION_PRESETS = [
  { label: "2 min", ms: 2 * 60_000 },
  { label: "10 min", ms: 10 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "1 day", ms: 24 * 60 * 60_000 },
];

/** Epoch ms → value for <input type="datetime-local"> in the user's local time zone. */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function CreatePage() {
  const { identity } = useBidderIdentity(); // RequireName guarantees a name here
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startingPrice, setStartingPrice] = useState("");
  const [minIncrement, setMinIncrement] = useState("1.00");
  const [endsAtLocal, setEndsAtLocal] = useState(() => toLocalInput(Date.now() + 10 * 60_000));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const startingPriceCents = parseEuroToCents(startingPrice);
    const minIncrementCents = parseEuroToCents(minIncrement);
    const endsAt = new Date(endsAtLocal).getTime(); // datetime-local is parsed as local time
    const input = {
      title,
      description,
      startingPriceCents: startingPriceCents ?? undefined,
      minIncrementCents: minIncrementCents ?? undefined,
      endsAt: Number.isNaN(endsAt) ? undefined : endsAt,
      sellerName: identity.name ?? "",
    };

    // Same schema as the server, for instant feedback. The server re-validates with its own clock.
    const parsed = createAuctionInputSchema(Date.now()).safeParse(input);
    const found: Errors = parsed.success ? {} : toFieldErrors(parsed.error);
    if (startingPrice.trim() && startingPriceCents === null) found.startingPriceCents = ["Enter an amount like 150 or 150.50"];
    if (minIncrement.trim() && minIncrementCents === null) found.minIncrementCents = ["Enter an amount like 5 or 2.50"];
    setErrors(found);
    const problems = Object.keys(found).length;
    if (!parsed.success || problems > 0) {
      notify.error(`Please fix ${problems === 1 ? "the highlighted field" : `the ${problems} highlighted fields`}.`, "create-invalid");
      return;
    }

    setSubmitting(true);
    try {
      const { id, sellerKey } = await createAuction(parsed.data);
      notify.success("Your auction is live. Share the bidder link!");
      navigate(`/a/${id}/seller?key=${encodeURIComponent(sellerKey)}&created=1`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.body?.fieldErrors) {
        setErrors(err.body.fieldErrors);
        notify.error(Object.values(err.body.fieldErrors).flat().join(" "), "create-invalid");
      } else {
        const message = err instanceof Error ? err.message : "Something went wrong";
        setFormError(message);
        notify.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-2xl">
        <Eyebrow>New auction</Eyebrow>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">Put something under the hammer</h1>
        <p className="mt-3 text-muted">
          Describe the item, set the price rules and an end time. You'll get a link to share with bidders and a private
          link to watch the auction live.
        </p>

        <Card className="mt-8">
          <form onSubmit={submit} noValidate className="space-y-5">
            <Field label="Title" errors={errors.title}>
              <TextInput
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="e.g. Leica M3 rangefinder, 1956"
                invalid={!!errors.title}
              />
            </Field>

            <Field label="Description" errors={errors.description}>
              <TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                placeholder="Condition, history, what's included…"
                invalid={!!errors.description}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Starting price" errors={errors.startingPriceCents} hint="EUR, cents allowed">
                <MoneyInput
                  value={startingPrice}
                  onChange={(e) => setStartingPrice(e.target.value)}
                  placeholder="150.00"
                  invalid={!!errors.startingPriceCents}
                />
              </Field>
              <Field label="Minimum bid increment" errors={errors.minIncrementCents} hint="Each bid must beat the last by this">
                <MoneyInput
                  value={minIncrement}
                  onChange={(e) => setMinIncrement(e.target.value)}
                  placeholder="5.00"
                  invalid={!!errors.minIncrementCents}
                />
              </Field>
            </div>

            <Field label="End time" errors={errors.endsAt} hint="Your local time. Bids in the last 30 seconds extend the auction.">
              <TextInput
                type="datetime-local"
                step={1}
                value={endsAtLocal}
                onChange={(e) => setEndsAtLocal(e.target.value)}
                invalid={!!errors.endsAt}
              />
            </Field>
            <div className="-mt-2 flex flex-wrap gap-2">
              {DURATION_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setEndsAtLocal(toLocalInput(Date.now() + preset.ms))}
                  className="glass-control rounded-full px-3.5 py-1.5 text-[13px] font-medium transition hover:bg-white/85 active:scale-95"
                >
                  in {preset.label}
                </button>
              ))}
            </div>

            {formError && <Notice tone="error">{formError}</Notice>}
            {errors.sellerName && <Notice tone="error">{errors.sellerName.join(" ")}</Notice>}

            <p className="text-sm text-muted wrap-anywhere">
              Selling as <span className="font-semibold text-ink">{identity.name}</span> ·{" "}
              <Link href="/" className="text-accent hover:underline">
                change name
              </Link>
            </p>

            <Button type="submit" disabled={submitting} className="w-full py-3.5 text-base">
              {submitting ? "Creating…" : "Create auction"}
            </Button>
          </form>
        </Card>
      </div>
    </Layout>
  );
}
