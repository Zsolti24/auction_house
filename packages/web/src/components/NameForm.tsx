import { useState, type FormEvent, type ReactNode } from "react";
import { DISPLAY_NAME_MAX, displayNameSchema } from "@auction/shared";
import { useBidderIdentity } from "../identity";
import { notify } from "../notify";
import { Layout } from "./Layout";
import { Button, Card, Eyebrow, Field, TextInput } from "./ui";

/** Validates a display name with the same rule the server uses. Returns the error, or null. */
export function displayNameError(name: string): string | null {
  const result = displayNameSchema.safeParse(name);
  return result.success ? null : (result.error.issues[0]?.message ?? "Invalid name");
}

/** Single-field name form. Used inline on the bidder page and by RequireName. */
export function NameForm({ onSubmit, submitLabel }: { onSubmit: (name: string) => void; submitLabel: string }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problem = displayNameError(name);
    if (problem) {
      setError(problem);
      notify.error(problem, "name-required");
      return;
    }
    notify.success(`Welcome, ${name.trim()}!`, "name-set");
    onSubmit(name.trim());
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Your display name" errors={error ? [error] : undefined} hint="Shown to others. No account needed.">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          autoFocus
          placeholder="e.g. Anna"
          invalid={!!error}
        />
      </Field>
      <Button type="submit" className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}

/**
 * Guard for pages that need a name (create, live list): asks for it first if it isn't set.
 * The name lives in localStorage, so the page below reads it on mount.
 */
export function RequireName({ children, purpose }: { children: ReactNode; purpose: string }) {
  const { identity, setName } = useBidderIdentity();
  if (identity.name) return <>{children}</>;

  return (
    <Layout>
      <Card className="mx-auto max-w-md">
        <Eyebrow>One quick thing</Eyebrow>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">What should we call you?</h1>
        <p className="mt-2 mb-5 text-muted">You need a display name to {purpose}.</p>
        <NameForm onSubmit={setName} submitLabel="Continue" />
      </Card>
    </Layout>
  );
}
