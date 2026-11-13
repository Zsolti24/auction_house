import { useCallback, useEffect, useState } from "react";
import { probeStatus } from "../api";

export type ConnectionState = "connecting" | "live" | "reconnecting" | "failed";

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 10_000;
/** The server pings every 10 s; this much silence means the connection is dead even if "open". */
const SILENCE_LIMIT_MS = 25_000;

/**
 * Subscribes to an SSE stream whose every message is a full snapshot of some state. Because each
 * message is complete, reconnecting (network blip, server restart, page reload) needs no special
 * handling: the first message after reconnect is simply the current truth.
 *
 * EventSource retries by itself only after a dropped connection. If a reconnect attempt gets an
 * HTTP error (e.g. 502 from a proxy while the server restarts) it gives up for good — so on a
 * closed stream we check why: 404 / 403 are final, anything else is retried with backoff.
 *
 * A proxy can also keep the browser's side of the stream "open" after the server died, so no
 * error ever fires. The server sends a `ping` event every 10 s; after SILENCE_LIMIT_MS without
 * any event the stream is treated as dead and replaced.
 *
 * `clockOffset` = server clock − local clock, measured on every message, so countdowns follow
 * the server's time even if the user's computer clock is wrong.
 *
 * `pick(current, incoming)` decides which snapshot to keep (they can arrive out of order when
 * the same state also comes from HTTP responses). It must be a stable function.
 */
export function useEventStream<T extends { serverTime: number }>(
  streamUrl: string,
  probeUrl: string,
  pick: (current: T | null, incoming: T) => T,
) {
  const [data, setData] = useState<T | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [failure, setFailure] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);

  const apply = useCallback(
    (incoming: T) => {
      setClockOffset(incoming.serverTime - Date.now());
      setData((current) => pick(current, incoming));
    },
    [pick],
  );

  useEffect(() => {
    setData(null);
    setFailure(null);
    setConnection("connecting");

    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = RETRY_MIN_MS;
    let lastActivity = Date.now();
    let disposed = false;

    const connect = () => {
      lastActivity = Date.now();
      source = new EventSource(streamUrl);
      source.onmessage = (event: MessageEvent<string>) => {
        lastActivity = Date.now();
        apply(JSON.parse(event.data) as T);
        setConnection("live");
        retryDelay = RETRY_MIN_MS;
      };
      source.addEventListener("ping", () => {
        lastActivity = Date.now();
      });
      source.onerror = () => {
        if (source?.readyState !== EventSource.CLOSED) {
          setConnection("reconnecting"); // dropped connection: the browser retries by itself
          return;
        }
        source.close();
        setConnection("reconnecting");
        void probeStatus(probeUrl).then((status) => {
          if (disposed) return;
          if (status === 404 || status === 403) {
            setConnection("failed");
            setFailure(status === 404 ? "This auction does not exist." : "This seller link is not valid.");
            return;
          }
          // Server down or restarting (0 / 5xx): try again, backing off up to RETRY_MAX_MS.
          retryTimer = setTimeout(connect, retryDelay);
          retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        });
      };
    };

    connect();

    const watchdog = setInterval(() => {
      const waitingForRetry = source?.readyState === EventSource.CLOSED;
      if (waitingForRetry || Date.now() - lastActivity < SILENCE_LIMIT_MS) return;
      source?.close();
      setConnection("reconnecting");
      connect();
    }, 5_000);

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      clearInterval(watchdog);
      source?.close();
    };
  }, [streamUrl, probeUrl, apply]);

  return { data, connection, failure, clockOffset, apply };
}
