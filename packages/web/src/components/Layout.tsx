import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "../router";
import type { ConnectionState } from "../hooks/useAuctionStream";
import { notify } from "../notify";
import { cx } from "./ui";

export function Layout({ children, connection }: { children: ReactNode; connection?: ConnectionState }) {
  useConnectionToasts(connection);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 px-3 pt-3 sm:px-6">
        <div className="glass mx-auto flex max-w-5xl items-center justify-between rounded-full px-5 py-2.5">
          <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span aria-hidden className="grid size-7 place-items-center rounded-full bg-accent text-sm text-white">
              ◆
            </span>
            Live Auction
          </Link>
          {connection && <ConnectionBadge state={connection} />}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}

/** Toast when an established live connection drops, and again when it comes back. */
function useConnectionToasts(connection: ConnectionState | undefined) {
  const wasLive = useRef(false);
  const lost = useRef(false);
  useEffect(() => {
    if (connection === "live") {
      if (lost.current) {
        notify.dismiss("connection-lost");
        notify.success("Back online — showing the latest state.", "connection-back");
      }
      wasLive.current = true;
      lost.current = false;
    } else if (connection === "reconnecting" && wasLive.current && !lost.current) {
      lost.current = true;
      notify.warning("Connection lost. Reconnecting…", "connection-lost");
    }
  }, [connection]);
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const label = { connecting: "Connecting", live: "Live", reconnecting: "Reconnecting", failed: "Offline" }[state];
  return (
    <span className="glass-control inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold">
      <span
        className={cx(
          "size-2 rounded-full",
          state === "live" && "animate-pulse bg-[#34c759]",
          (state === "connecting" || state === "reconnecting") && "bg-[#ff9500]",
          state === "failed" && "bg-danger",
        )}
      />
      {label}
    </span>
  );
}
