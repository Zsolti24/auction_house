import type { AddressInfo } from "node:net";
import { buildApp } from "../src/app";
import type { Clock } from "../src/clock";

/** Starts the real app on a random port and talks to it over real HTTP (not app.inject). */
export async function startServer(options: { dbPath?: string; clock?: Clock; sseHeartbeatMs?: number } = {}) {
  const app = buildApp({ dbPath: options.dbPath ?? ":memory:", clock: options.clock, sseHeartbeatMs: options.sseHeartbeatMs });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  // `any` default: tests assert on response bodies of many shapes; they can pass a type when useful.
  async function request<T = any>(method: string, path: string, body?: unknown) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  return {
    app,
    baseUrl,
    get: <T = any>(path: string) => request<T>("GET", path),
    post: <T = any>(path: string, body?: unknown) => request<T>("POST", path, body),
    stream: <T = any>(path: string) => openStream<T>(baseUrl + path),
    close: () => app.close(),
  };
}

/**
 * Minimal SSE client on top of fetch streaming (Node has no built-in EventSource without a flag).
 * `next()` resolves with the next default (`message`) event's data, parsed as JSON — exactly
 * what the browser's `onmessage` would see. `nextEventOfType()` waits for a named event.
 */
export async function openStream<T>(url: string) {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal });
  if (!res.ok || !res.body) throw new Error(`SSE ${url} failed with ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  function parseBlock(block: string) {
    const lines = block.split("\n");
    const type = lines.find((l) => l.startsWith("event: "))?.slice(7) ?? "message";
    const data = lines
      .filter((l) => l.startsWith("data: "))
      .map((l) => l.slice(6))
      .join("\n");
    return { type, data };
  }

  async function nextEventOfType(type: string, timeoutMs = 3_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end !== -1) {
        const event = parseBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (event.data && event.type === type) return event.data; // skips `retry:` and other events
        continue;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Timed out waiting for SSE message");
      const chunk = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for SSE message")), remaining)),
      ]);
      if (chunk.done) throw new Error("SSE stream closed");
      buffer += chunk.value;
    }
  }

  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    next: async (timeoutMs?: number) => JSON.parse(await nextEventOfType("message", timeoutMs)) as T,
    nextEventOfType,
    close: () => controller.abort(),
  };
}
