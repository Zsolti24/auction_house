import { Layout } from "../components/Layout";
import { Card } from "../components/ui";
import type { ConnectionState } from "../hooks/useAuctionStream";
import { Link } from "../router";

export function Loading({ connection }: { connection: ConnectionState }) {
  return (
    <Layout connection={connection}>
      <div className="flex justify-center py-24">
        <span className="size-8 animate-spin rounded-full border-[3px] border-accent/20 border-t-accent" aria-label="Loading" />
      </div>
    </Layout>
  );
}

export function Unavailable({ message, connection }: { message: string; connection?: ConnectionState }) {
  return (
    <Layout connection={connection}>
      <Card className="mx-auto max-w-lg text-center">
        <h1 className="text-2xl font-bold tracking-tight">{message}</h1>
        <p className="mt-3 text-muted">
          Check the link, or{" "}
          <Link href="/" className="font-semibold text-accent hover:underline">
            go to the start page
          </Link>
          .
        </p>
      </Card>
    </Layout>
  );
}
