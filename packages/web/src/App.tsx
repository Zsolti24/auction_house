import { useEffect, useState } from "react";
import { ANTI_SNIPING_WINDOW_MS } from "@auction/shared";

export function App() {
  const [health, setHealth] = useState<string>("checking…");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => (r.ok ? "server ok" : `server error ${r.status}`))
      .catch(() => "server unreachable")
      .then(setHealth);
  }, []);

  return (
    <main className="mx-auto max-w-2xl p-8 font-sans">
      <h1 className="text-3xl font-bold">Live Auction House</h1>
      <p className="mt-2 text-slate-600">
        Scaffold — {health}. Anti-sniping window: {ANTI_SNIPING_WINDOW_MS / 1000}s.
      </p>
    </main>
  );
}
