# Live Auction House

A real-time auction app: a seller creates an auction and shares a link, bidders compete live, and
the server decides who wins. Built for the Square21 fullstack assessment. The plan, every decision
and a log of the agent's mistakes are in [ROADMAP.md](ROADMAP.md).

**Stack:** TypeScript · pnpm workspaces · Node + Fastify · SQLite (`better-sqlite3`) · REST + Server-Sent Events · React + Vite + Tailwind · Vitest + Playwright

## Running it

Requires **Node.js 22.12+ or 24+** (not 23 / 25; `.nvmrc` says 24) and **pnpm** (version pinned
in `package.json`; `corepack enable` picks it up).

```bash
pnpm install
pnpm dev         # server on http://localhost:3001, web app on http://localhost:5173
pnpm test        # all tests, including browser tests (first run downloads Chromium)
pnpm typecheck
```

Open http://localhost:5173, enter a name and **Create an auction**. In a second browser (or a
private window) enter another name and **Bid on an auction**. Data lives in
`packages/server/data/auction.db`; delete it to start fresh.

## Architecture

```
packages/
  shared/   types, zod validation schemas, money helpers — used by server and web
  server/   Fastify API, bidding rules (domain.ts), SQLite, SSE fan-out, end timers
  web/      React app: landing, live/ended auction list, create, bidder page, seller page
  e2e/      Playwright browser tests against the real app
```

```
 browser ──POST /bids──▶ AuctionService.placeBid: one SQLite transaction (read → decide → write)
    ▲  ◀── 201 accepted / 409 rejected, with the fresh state
    └── SSE: full state ◀── AuctionHub ◀── every accepted change, and the end timer
```

Key decisions:

- **REST for commands, SSE for updates.** A bid gets a direct answer (accepted, or rejected with
  the reason); everything else is pushed. SSE needs no library and reconnects by itself.
- **Every SSE message is the full state, never a diff.** Reconnect, reload or a missed message:
  the next message makes the client correct again.
- **SQLite with a synchronous driver.** No Docker, and it makes the bid logic easy to reason about.
- **Shared validation and money code.** The form gives instant feedback; the server's check is the
  one that counts. Money is integer cents everywhere, parsed from text, never `parseFloat`.
- **No accounts.** A participant is a random id + display name in `localStorage`; "You won" is
  decided by the id. The seller link carries a secret key; only its SHA-256 hash is stored.
- **UI:** iOS-like "liquid glass" theme; every result is shown on the page *and* as a toast; long
  text and the largest prices never overflow; the outbid cue is a sound + flash (the only place
  the task asks for one) and can be muted.

## Concurrency and time

**The server decides.** The client only displays what the server sends.

**Bidding rules** ([domain.ts](packages/server/src/domain.ts)):

- **First bid: at least the starting price.** The task says a bid must beat "the current highest
  bid" by the increment; before any bid there is no highest bid, so the starting price is the
  opening bid itself (as in real auctions). The other reading — starting price + increment —
  would be a one-line change in `minNextBid`.
- **Later bids: at least highest + increment.** With €5 steps, after €100.00 → €105.00 is the minimum.
- The leader may raise their own bid. Amounts are €0.01 – €1,000,000,000.00.

**One bid = one synchronous transaction** (`BEGIN IMMEDIATE`): read leader and end time, read the
clock, decide, insert, extend the end if needed. `better-sqlite3` is synchronous and Node is
single-threaded, so nothing runs between reading the leader and writing the bid: two
"simultaneous" bids are decided one after the other and can never both win. **Ending early**
(seller, only before the first bid) is the same kind of transaction, so a bid and an end-early
racing each other can't both succeed.

**Rejection reasons.** Each bid carries the id of the leader the bidder saw. Too low now, but
enough for what they saw → `OUTBID` ("someone else bid in the meantime"); otherwise `TOO_LOW`;
at or after the end → `AUCTION_ENDED`.

**Time.**
- Only the server clock counts; it is injected (`Clock`) so tests control time.
- "Ended" is never stored: every request computes `now >= endsAt` (a bid at exactly `endsAt` is
  late). That's why results survive restarts. Ending early just moves `endsAt` to now.
- **Anti-sniping:** a bid with ≤ 30 s left sets `endsAt = bidTime + 30 s`; the new end is pushed
  to everyone.
- End timers only *announce* the end; correctness never depends on them. They are rebuilt from
  the database on startup.
- The browser runs its countdown on server time (offset measured on every message) and shows
  "Closing…" at zero until the server confirms the end.

**Reconnects.** The client retries with backoff (a proxy answers 502 while the server restarts),
and the server pings every 10 s so a client can replace a connection that went silent for 25 s.

## Tests

```bash
pnpm test                          # 138 unit/integration + 6 browser tests
pnpm --filter @auction/e2e test    # browser tests only (~1 min, auctions end in real time)
```

The four required scenarios are each tested twice — over real HTTP against the server, and in a
real browser with one browser context per person:

| Scenario | HTTP ([http.test.ts](packages/server/test/http.test.ts)) | Browser ([auction.spec.ts](packages/e2e/tests/auction.spec.ts)) |
|---|---|---|
| Main flow | create → Anna and Bob bid → end → winner, seller sees every bid | seller uses the form; two bidders bid via the link; "You won" / "You lost" / "Sold to Bob for €120.00" |
| Bids at the same moment | 20 parallel identical bids → exactly 1 accepted | both requests released together from a barrier → one accepted, one "outbid in the meantime" |
| Bid after the end | 409 `AUCTION_ENDED`, nothing stored | a page that fell behind bids late → rejected, reason shown |
| Anti-sniping | end → bid + 30 s, pushed to two watchers | other bidder and seller see the new end time live |

Also tested: the pure rules and their boundaries ([domain.test.ts](packages/server/test/domain.test.ts)),
a server restart mid-auction, ending early (incl. racing a bid, both orders checked), the live and
ended auction lists, money parsing and validation messages, and the frontend's view logic.

To check the tests themselves I broke three rules on purpose (bid at the exact end allowed,
anti-sniping off, `OUTBID` never reported); each made 3–6 tests fail.

## Known limitations and what I'd improve

- **One server process.** For several instances: Postgres with a row lock or conditional update,
  and SSE fan-out via Redis or `LISTEN/NOTIFY`.
- **Trust is "whoever has the link".** No accounts or rate limiting; the seller key is in a URL;
  identity is per browser.
- **Browser tests cover the main scenarios only.** Reconnect after a restart, the outbid cue,
  ending early and mobile layout were checked by hand.
- **Small things:** no maximum auction duration; dead connections behind a proxy take up to
  ~25 s to detect; the whole auction list is re-sent on every bid (fine at this scale);
  migrations are numbered, not named.

## AI usage

**Models and tools**

- **Claude Code (Claude Opus 5.5), VS Code extension:** the coding agent — planning with me, the
  roadmap, implementation, tests, and running checks.
- **Playwright MCP:** the agent drove a real browser for manual checks (two bidders + seller,
  screenshots, killing the server mid-auction).
- **Playwright Test:** the automated browser tests, written by the agent and reviewed by me.

**Agent setup**

- [CLAUDE.md](CLAUDE.md): the project rules (server decides, cents, injected clock, one transaction
  per bid, full snapshots, append-only migrations) plus working agreements I added after the
  agent got things wrong: I commit; race tests must show both outcomes happened; UI changes are
  checked in a browser at desktop and phone width; every agent mistake goes into the log.
- [ROADMAP.md](ROADMAP.md): the agreed plan, worked through phase by phase, with the
  [AI-validation log](ROADMAP.md#ai-validation-log).
- Personal Claude Code memory (outside the repo) holds the same two preferences: I commit, and the
  log is written in plain language. No custom skills.

**Validation: a case where the agent was wrong**

All automated tests passed after the frontend phase, but when I restarted the server during a
browser test, the page broke: after a reload it said "Could not connect" and gave up, and an open
page kept showing "Live" while receiving nothing. The agent had assumed the browser always
reconnects by itself — but the dev proxy answers 502 while the server is down, which the browser
treats as final, and the proxy kept the dead stream open. I had it add retries with backoff and a
heartbeat (ping every 10 s, reconnect after 25 s of silence), then re-ran the test killing the
server for 30 s: the page showed "Reconnecting…" and came back with the bids placed meanwhile.
More cases are in the [AI-validation log](ROADMAP.md#ai-validation-log).
