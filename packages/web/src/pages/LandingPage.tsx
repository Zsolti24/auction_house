import { useState, type FormEvent } from "react";
import { DISPLAY_NAME_MAX } from "@auction/shared";
import { displayNameError } from "../components/NameForm";
import { Layout } from "../components/Layout";
import { Button, Card, Field, TextInput } from "../components/ui";
import { useBidderIdentity } from "../identity";
import { notify } from "../notify";
import { navigate } from "../router";

/**
 * Entry point: one name, two ways in. The name is required for both and stored in localStorage,
 * so it is pre-filled next time and reused when bidding.
 */
export function LandingPage() {
  const { identity, setName } = useBidderIdentity();
  const [name, setNameInput] = useState(identity.name ?? "");
  const [error, setError] = useState<string | null>(null);

  const go = (target: "/auctions" | "/create") => (e?: FormEvent) => {
    e?.preventDefault();
    const problem = displayNameError(name);
    if (problem) {
      setError(problem);
      notify.error("Enter a display name first.", "name-required");
      return;
    }
    setName(name.trim());
    navigate(target);
  };

  return (
    <Layout>
      <div className="mx-auto max-w-xl pt-6 text-center sm:pt-16">
        <p className="glass-control inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-ink/80">
          <span className="size-2 animate-pulse rounded-full bg-[#34c759]" />
          Real-time bidding
        </p>
        <h1 className="mt-6 bg-gradient-to-b from-ink to-ink/60 bg-clip-text text-6xl font-bold tracking-tighter text-transparent sm:text-7xl">
          Live Auction
        </h1>
        <p className="mx-auto mt-4 max-w-md text-lg text-muted">
          Join a running auction and outbid the room, or put something under the hammer yourself.
        </p>

        <Card className="mt-10 p-7 text-left">
          <form onSubmit={go("/auctions")} noValidate className="space-y-5">
            <Field label="Your display name" errors={error ? [error] : undefined} hint="Shown next to your bids. No account needed.">
              <TextInput
                value={name}
                onChange={(e) => {
                  setNameInput(e.target.value);
                  setError(null);
                }}
                maxLength={DISPLAY_NAME_MAX}
                autoFocus
                placeholder="e.g. Anna"
                invalid={!!error}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button type="submit" className="py-3.5 text-base">
                Bid on an auction
              </Button>
              <Button type="button" variant="secondary" className="py-3.5 text-base" onClick={() => go("/create")()}>
                Create an auction
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </Layout>
  );
}
