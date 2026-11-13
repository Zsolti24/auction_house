import type { ReactNode } from "react";
import { Link } from "../router";
import type { ConnectionState } from "../hooks/useAuctionStream";
import { cx } from "./ui";

export function Layout({ children, connection }: { children: ReactNode; connection?: ConnectionState }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="font-display text-xl font-bold tracking-tight">
            Live Auction House
          </Link>
          {connection && <ConnectionBadge state={connection} />}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const label = { connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting…", failed: "Offline" }[state];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs font-medium">
      <span
        className={cx(
          "size-2 rounded-full",
          state === "live" && "animate-pulse bg-success",
          (state === "connecting" || state === "reconnecting") && "bg-warning",
          state === "failed" && "bg-accent",
        )}
      />
      {label}
    </span>
  );
}
