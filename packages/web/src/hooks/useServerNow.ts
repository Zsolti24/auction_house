import { useEffect, useState } from "react";

/** Ticking estimate of the server's current time (local clock + measured offset). */
export function useServerNow(clockOffset: number, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now() + clockOffset);

  useEffect(() => {
    setNow(Date.now() + clockOffset);
    const timer = setInterval(() => setNow(Date.now() + clockOffset), intervalMs);
    return () => clearInterval(timer);
  }, [clockOffset, intervalMs]);

  return now;
}
