# Live Auction House

A small real-time auction app: a seller creates an auction and shares a link, bidders compete live,
and the server decides who wins. Built for the Square21 fullstack engineering assessment.

**Stack:** TypeScript · pnpm workspaces · Node + Fastify · SQLite (`better-sqlite3`) · REST + Server-Sent Events · React + Vite + Tailwind + react-toastify · Vitest

The step-by-step plan, every design decision and the progress checklist are in [ROADMAP.md](ROADMAP.md).

## Running it

Requirements: Node.js ≥ 20 and pnpm (the exact version is pinned in `package.json`; run
`corepack enable` once and corepack will use it).

```bash
pnpm install     # install all packages
pnpm dev         # start server (http://localhost:3001) and web app (http://localhost:5173)
pnpm test        # run all tests, including the browser tests
pnpm typecheck   # type-check all packages
```

The first `pnpm test` downloads Playwright's Chromium (one time, needs internet). The browser
tests start their own server and web app on ports 3101 / 5174 with a temporary database, so
they don't touch your data and can run while `pnpm dev` is running.

Open http://localhost:5173, enter a display name and choose **Create an auction**. In a second
browser (or a private window, so it gets its own identity) enter another name and choose
**Bid on an auction**: the new auction is in the live list, and the list updates by itself.

The database is a single SQLite file at `packages/server/data/auction.db` (override with `DB_PATH`;
the server port with `PORT`). Delete the file to start from scratch.

## Architecture

```
packages/
  shared/   domain types, zod validation schemas, money helpers — used by server AND web
  server/   Fastify API, bidding rules, SQLite persistence, SSE fan-out, end timers
  web/      React app (pages below)
  e2e/      browser tests (Playwright) against the real running app
```

| Page | What it does |
|---|---|
| `/` | Landing: display name + **Bid on an auction** / **Create an auction** (both need a name) |
| `/auctions` | Auction list, updating in real time: running auctions on top (ending soonest first, with the current leader), ended ones below (most recent first, with the result) |
| `/create` | Create an auction (the seller's display name is stored with it) |
| `/a/:id` | Bidder page (asks for a name inline if you came straight from a shared link) |
| `/a/:id/seller?key=…` | Seller page: share links, every bid live, result, **End auction now** (only before the first bid, with a confirm step) |

```
 browser ──POST /bids──────────────▶ Fastify route ─▶ AuctionService.placeBid
    ▲                                                    │  one SQLite transaction:
    │                                                    │  read → decide (domain.ts) → write
    │ 201 accepted / 409 rejected + fresh snapshot ◀─────┤
    │                                                    ▼
    └──── SSE: full snapshot ◀── AuctionHub.publish ◀── on every accepted change
                                 EndTimers ─────────────▶ publish at the end time
 auction list page ◀── SSE: live + ended lists ◀── AuctionHub.publishLobby ◀── create / accepted bid / end
```

Key decisions (more detail and alternatives in [ROADMAP.md](ROADMAP.md#decisions)):

- **REST for commands, Server-Sent Events for updates.** A bid is a plain HTTP request, so the
  bidder gets a direct answer: accepted, or rejected with the reason. Everything that changes is
  pushed over SSE. SSE is one-way, needs no extra library, and the browser reconnects by itself.
- **Every SSE message is the full auction state, never a diff.** A client that reconnects,
  reloads or misses a message is correct again after the next message. There is no client-side
  state to repair.
- **SQLite with synchronous transactions.** No Docker or separate database process, and the
  synchronous driver is what makes the bid logic simple to reason about (see below).
- **Shared package.** The validation schema and money parsing are written once and used by both
  the form (instant feedback) and the server (the check that counts).
- **Money is integer cents everywhere.** User input like `152,50` is parsed as text, never with
  `parseFloat` (`parseFloat("0.29") * 100` is `28.999…`).
- **No accounts.** A participant is a random UUID plus one display name in `localStorage`, used
  both for bidding and as the seller name ("Offered by …"); a reload keeps both. "You won" is
  decided by the id, so two bidders called Anna are never confused. The seller gets a secret key
  in their link; only its SHA-256 hash is stored.
- **Look and feel: "liquid glass".** A clean, iOS-like theme: frosted translucent panels over a
  soft colour field, system font (SF Pro on Apple devices, Inter elsewhere), iOS blue for
  actions, iOS red only for errors. All design tokens live in
  [index.css](packages/web/src/index.css).
- **Feedback twice: inline and as a toast.** Every result the user should notice (validation
  errors, bid accepted / too low / outbid in the meantime / auction ended, being outbid while
  watching, the auction ending, connection lost / back, link copied, a new bid for the seller)
  shows a toast, *and* stays visible on the page after the toast fades. Toasts for repeatable
  events carry an id, so a burst of updates shows one toast, not a pile.
- **Outbid cue: sound + visual, only where the task asks for it.** When someone outbids you
  while you watch, you hear a short two-tone chime (synthesised with Web Audio, no audio file),
  the live panel flashes orange and shakes (no shake with *reduce motion*), the tab title shows
  "⚠ Outbid!" if you're on another tab, plus the toast and the inline notice. The task asks for a
  sound or visual cue only for being outbid, so nothing else makes a sound. Browsers only allow
  audio after a click; anyone who can be outbid has already clicked "Place bid". The sound can be
  muted with a toggle under the bid form (remembered per browser). Code:
  [outbidCue.ts](packages/web/src/lib/outbidCue.ts).
- **User text never breaks the layout.** Titles, descriptions and names wrap anywhere, and grid
  columns may shrink below their content, so a long unbroken word or pasted URL stays inside its
  card.
- **The auction list works like an auction page.** Its own SSE stream (`/api/lobby/events`)
  sends both lists — running and recently ended auctions, with price, bid count, end time and
  leader / winner — on connect and whenever an auction is created, gets an accepted bid or ends.
  Both lists are read at the same server time, so an auction is always in exactly one of them;
  when it ends, the end timer's push moves it from the top list to the bottom one for everyone.
  Same reconnect logic as the auction pages.

## Concurrency and time

**The server decides.** The client never decides whether a bid is valid or whether the auction
is over. It only displays what the server sends.

**One bid = one synchronous transaction** (`BEGIN IMMEDIATE`): read the current leader and end
time, read the clock, decide, insert the bid, extend the end time if needed. `better-sqlite3`
is synchronous and Node runs JavaScript on one thread, so nothing else can run between reading
the leader and writing the new bid. Two bids that arrive "at the same moment" are decided one
after the other, the second one against the state the first one created. They can never both be
accepted as the highest bid. The pure rules live in [domain.ts](packages/server/src/domain.ts),
with no I/O, so they are easy to test.

**Ending early** (seller, only before the first bid) uses the same single transaction: check the
seller key, check there are no bids and the auction is still running, then move `endsAt` to
"now" and mark it as ended early. So if a bid and an end-early arrive together, exactly one
wins: bid first → ending is refused with 409; ending first → the bid gets `AUCTION_ENDED`.
Because "ended" is still derived from `endsAt`, nothing else (timers, lists, restarts) needed to
change.

**Rejection reasons.** With every bid the client sends the id of the leading bid it saw.
If the bid is too low now, but would have been enough for what the bidder saw and someone else
has bid since, the reason is `OUTBID` ("someone else bid in the meantime"). Otherwise it is
`TOO_LOW`. A bid at or after the end time is `AUCTION_ENDED`.

**Time.**
- Only the server clock counts, and it is injected (`Clock`), so tests control time exactly.
- "Ended" is never stored. It is computed on every request: `now >= endsAt`. A bid arriving
  exactly at `endsAt` is too late. This is why the result is correct after a restart: there is
  no flag that could be out of date.
- Anti-sniping: if a bid is accepted with ≤ 30 s left, `endsAt = bidTime + 30 s`. The new end
  time is part of the pushed state, so everyone sees it, and the countdown shows
  "Extended by a late bid".
- End timers (`setTimeout`, one per live auction) only *notify* watchers that the auction ended.
  Correctness never depends on them. They are rebuilt from the database on startup, and delays
  longer than `setTimeout`'s ~24.8-day limit are chained.
- The browser measures `serverTime − localTime` on every message and runs its countdown on
  server time. When the countdown reaches zero it shows "Closing…" until the server confirms the
  end. Bidding closes for everyone at the same moment.

**Reconnects and restarts.** SSE reconnects by itself. If a reconnect attempt gets an error (for
example a 502 from a proxy while the server restarts), the client keeps retrying with backoff
instead of giving up. The server also sends a `ping` every 10 s, and a client that hears nothing
for 25 s replaces the connection, because a proxy can keep a dead stream looking "open".

## Tests

```bash
pnpm test                               # everything (138 unit/integration + 6 browser tests)
pnpm --filter @auction/server test      # one package
pnpm --filter @auction/e2e test         # only the browser tests (~1 minute: auctions end in real time)
```

| Where | What |
|---|---|
| [shared/test](packages/shared/test) | Money parsing and formatting edge cases; validation rules and messages (price/increment ≤ 0, end time in the past, length limits) |
| [server/test/domain.test.ts](packages/server/test/domain.test.ts) | Pure rules: end-time boundary, minimum next bid, TOO_LOW vs OUTBID vs AUCTION_ENDED, anti-sniping at 30.001 s / 30 s / 1 ms |
| [server/test/auctionService.test.ts](packages/server/test/auctionService.test.ts) | Service + real SQLite with a fake clock: main flow, same-moment bids, anti-sniping chains, seller key, persistence across a restart |
| [server/test/http.test.ts](packages/server/test/http.test.ts) | Real HTTP on a random port: everything below, plus SSE pushes, error codes, heartbeat, the auction list (live vs. ended split, order, leader / winner, pushes on create / bid, an auction moving to "ended" by itself) |
| [e2e/tests](packages/e2e/tests/auction.spec.ts) | **Browser tests** (Playwright, Chromium, one browser context per person): the four required scenarios through the real UI, plus a reload and a too-large bid amount — see below |
| [web/test](packages/web/test) | View logic: which snapshot is newer, leading / outbid / won / lost, when to fire the "you've been outbid" toast, countdown formatting |

The four required scenarios, over real HTTP:

- **Main flow:** create → Anna and Bob place five bids → time passes the end → Anna wins; the
  seller view lists every bid.
- **Bids at the same moment:** 20 parallel requests for the same amount → exactly one 201,
  nineteen `OUTBID`. 50 parallel random bids → every accepted bid beats the previous one by at
  least the increment.
- **Bid after the end:** → 409 `AUCTION_ENDED`, nothing stored.
- **Anti-sniping:** a bid 10 s before the end moves it to bid + 30 s, and two separate watchers
  both receive the new end time.

The same four scenarios again **in a real browser** ([auction.spec.ts](packages/e2e/tests/auction.spec.ts)):

- **Main flow:** the seller creates the auction through the form, Anna and Bob join via the
  bidder link in separate browser contexts and place four bids (pre-filled minimum, live
  updates, the outbid notice), the auction ends on its own, and Bob sees "You won", Anna
  "You lost", everyone "Sold to Bob for €120.00".
- **Bids at the same moment:** both bid requests are held at a barrier until both were sent,
  then released together, so both carry the same view — exactly one is accepted, the other sees
  "Someone else bid in the meantime".
- **Bid after the end:** a bidder whose page fell behind (live updates frozen while it was
  still running) bids after the server-side end → the server rejects it, the toast says why,
  and the page switches to the result.
- **Anti-sniping:** a bid in the last 30 s moves the end to bid + 30 s; the other bidder and the
  seller see the new "Ends at …" and the "Extended by a late bid" hint without reloading.

Other risky behaviour that is tested: a server restart in the middle of an auction (same state
and winner, and the "ended" push still arrives), a bid exactly at `endsAt`, a rejected late bid
not extending the auction, the seller key not being stored in plain text, upgrading a
database created before seller names existed, and ending early: allowed only without bids, needs
the seller key, survives a restart, is pushed to bidders / seller / list, and a bid racing an
end-early never lets both succeed (the test alternates which request is sent first and checks
that both outcomes actually occurred).

How I checked the tests themselves: I broke three rules on purpose (bids allowed at the exact
end, anti-sniping disabled, `OUTBID` never reported), and each change made 3–6 tests fail. I also
ran the full flow by hand in a browser with two separate bidder sessions and a seller tab,
including killing the server for 30 s in the middle of an auction.

## Known limitations and what I'd improve

- **One server process.** The concurrency guarantee relies on a single Node process owning the
  SQLite file. To run several instances I would move to Postgres (row lock or a conditional
  `UPDATE … WHERE leading_bid_id = $expected`) and fan out SSE through Redis or Postgres
  `LISTEN/NOTIFY`.
- **Browser tests cover the main scenarios, not everything.** The four required scenarios and a
  reload run in a real browser. Not covered there (checked by hand instead): the reconnect /
  heartbeat watchdog after a server restart, the outbid sound and flash, ending early, the
  auction list, and mobile layout. They run in Chromium only, and take about a minute because
  auctions end in real time.
- **Trust model is "whoever has the link".** No accounts, display names are not unique, no rate
  limiting, and the seller key lives in a URL (browser history). Fine for this scope, not for
  real money.
- **Bidder identity is per browser.** Another browser or device is a new bidder.
- **Countdown accuracy.** The client's clock offset ignores network latency (usually tens of
  milliseconds). It only affects the display; the server decides.
- **Dead-connection detection takes up to ~25 s** behind a proxy that hides the disconnect.
- **The bidder view shows the 10 most recent bids**; the seller view shows all of them, without
  pagination. The auction list shows at most 100 running and the 20 most recently ended
  auctions, and is not searchable.
- **The auction list is rebuilt on every change.** Any accepted bid anywhere pushes the whole list
  to everyone on the list page. Fine at this scale; with many busy auctions I would throttle
  these pushes (e.g. at most one per second) or send per-auction updates.
- **Migrations are numbered, not named.** A migration that was applied locally and then reverted
  in git leaves the database "ahead" of the code (this happened to me during development; see
  the AI-validation log). A real project would record migration names/checksums and fail loudly.
- **Optional extras:** all three are done — ending early (before the first bid), the list of
  live auctions (with ended auctions below), and the outbid sound + visual cue.

## AI usage

**Models and tools**

- **Claude Code (Claude Opus 5.5) in the VS Code extension:** the main coding agent. Used for
  planning the architecture with me, writing the roadmap, implementing each phase, writing tests,
  and running the checks (typecheck, tests, smoke tests with `curl`).
- **Playwright MCP (driven by Claude Code):** manual browser testing with isolated contexts for
  two bidders plus the seller, screenshots for visual review, and the server-restart test.
- **Playwright Test:** the automated browser tests in `packages/e2e`, written by the agent and
  reviewed by me (see the validation log for the first version's mistakes).

**Agent setup**

- [CLAUDE.md](CLAUDE.md): project rules for the agent. The server decides; money in cents; time
  only through the injected `Clock`; no `await` inside the bid transaction; full snapshots over
  SSE; tests written together with the logic; small conventional commits.
- [ROADMAP.md](ROADMAP.md): the plan we agreed on before coding. The agent works phase by phase,
  ticks items off, and keeps an AI-validation log there.
- Personal Claude Code memory (outside the repo): the agent does not commit (I review and commit
  each phase myself) and writes the validation log in plain language.
- No custom skills or other rules files.

**Validation: a case where the agent was wrong**

All automated tests passed after the frontend phase, but when I actually restarted the server
during a browser test, the page broke in two ways. First, after a reload it showed "Could not
connect" and gave up for good. The dev proxy answers 502 while the server is down, and the
browser's `EventSource` treats an HTTP error as final, but the agent's design assumed it would
always reconnect by itself. Second, a page that was already open kept showing "Live" while
receiving nothing, because the proxy kept the dead stream open. I had the agent add retries with
backoff for server errors, plus a heartbeat (server `ping` every 10 s, client reconnects after
25 s of silence). Then I re-ran the same test, killing the server for 30 seconds: the page
switched to "Reconnecting…" and came back with the bids placed in the meantime, without a reload.

Smaller cases are in the [AI-validation log](ROADMAP.md#ai-validation-log), for example a
concurrency test that did not test what its name said, and a restart test that forgot about
anti-sniping.
