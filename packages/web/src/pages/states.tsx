import { Layout } from "../components/Layout";
import { Card } from "../components/ui";
import type { ConnectionState } from "../hooks/useAuctionStream";
import { Link } from "../router";

export function Loading({ connection }: { connection: ConnectionState }) {
  return (
    <Layout connection={connection}>
      <p className="py-20 text-center text-muted">Loading auction…</p>
    </Layout>
  );
}

export function Unavailable({ message, connection }: { message: string; connection?: ConnectionState }) {
  return (
    <Layout connection={connection}>
      <Card className="mx-auto max-w-lg text-center">
        <h1 className="font-display text-2xl font-bold">{message}</h1>
        <p className="mt-3 text-muted">
          Check the link, or{" "}
          <Link href="/" className="font-semibold text-accent underline underline-offset-2">
            start a new auction
          </Link>
          .
        </p>
      </Card>
    </Layout>
  );
}
