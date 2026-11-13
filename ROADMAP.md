# Roadmap — Live Auction House

Working plan for the Square21 fullstack assessment. Timebox: ~4 hours for the core,
optional extras afterwards. Each phase ends with green tests and a commit.

## Decisions

| Area | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces: `packages/shared`, `packages/server`, `packages/web` | Simple, strict deps, `pnpm -r` runs scripts everywhere |
| Backend | Node + Fastify + TypeScript | Fast, typed, `app.inject()` makes HTTP tests trivial |
| Real-time | REST for commands, Server-Sent Events for pushes | Bids get a direct HTTP response (accepted / rejected + reason); `EventSource` reconnects by itself; no extra dependency |
| Database | SQLite via `better-sqlite3` | Single file, no Docker, synchronous transactions serialize bids within the process |
| Frontend | React + Vite + Tailwind CSS | Fast iteration |
| Tests | Vitest, injectable `Clock` | Time-dependent rules are tested without real waiting |
| Theme | General auction (any item, text description) | Focus on behaviour, clean neutral UI |

## Domain rules

- **Money** is stored and transferred as integer cents. User input `"152.50"` is parsed as a string, never via `parseFloat`.
- **Time**: only the server clock counts. Every snapshot carries `serverTime`; the client computes an offset and corrects its countdown.
- **Ended** is derived, not stored: `cancelledAt != null || now >= endsAt`. Winner = highest bid. This makes the result correct after restarts with nothing to keep in sync.
- **First bid** must be `>= startingPrice`. Every later bid must be `>= highest + minIncrement`.
- **Leader may raise** their own bid.
- **Bid exactly at `endsAt`** is rejected.
- **Anti-sniping**: if `endsAt - now <= 30s` when a bid is accepted, `endsAt = now + 30s`.
- **Seller access**: random `sellerKey` returned on creation; seller link is `/a/:id/seller?key=…`.
- **Bidder identity**: display name + UUID, both in `localStorage`.

## Bid algorithm (single SQLite transaction)

1. Auction ended or cancelled → `AUCTION_ENDED`
2. `minNext = noBids ? startingPrice : highest + minIncrement`
3. `amount < minNext` →
   - leading bid changed since the client's `expectedLeadingBidId` **and** the bid would have been
     valid in the state the client saw → `OUTBID`
   - otherwise (incl. unknown `expectedLeadingBidId`) → `TOO_LOW`
4. Insert bid; apply anti-sniping extension
5. Commit → broadcast full snapshot over SSE → reschedule the end timer

Concurrency: one Node process + synchronous `better-sqlite3` means the transaction runs
to completion before any other request is processed, so two simultaneous bids are
evaluated strictly one after the other. Multi-instance would need DB-level locking /
conditional updates (documented as a limitation).

End timer: `setTimeout` per active auction pushes the "ended" snapshot; on startup timers
are rebuilt from the DB. Correctness never depends on the timer — every request re-derives
the state from `now`.

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/auctions` | Create → `{ id, sellerKey }` |
| `GET /api/auctions/:id` | Public snapshot + `serverTime` |
| `POST /api/auctions/:id/bids` | `{ bidderId, bidderName, amountCents, expectedLeadingBidId }` |
| `GET /api/auctions/:id/events` | SSE: full snapshot on connect and after every change |
| `GET /api/auctions/:id/seller?key=…` | Seller view with all bids |
| `POST /api/auctions/:id/close` | *Extra*: end early (only before the first bid) |
| `GET /api/lobby` | *Extra*: auction list — `live` (soonest end first) and `ended` (most recent first, max 20), each with leader / winner |
| `GET /api/lobby/events` | *Extra*: SSE, both lists on connect and on every create / accepted bid / end |

Every SSE message is a full snapshot, not a diff, so clients can never drift from the
server state; reconnect = fresh state.

## Phases

### Phase 0 — Setup (~25 min)
- [x] `git init`, remote, `ROADMAP.md`, `CLAUDE.md`
- [x] pnpm workspace, shared `tsconfig.base.json`, `.gitignore`
- [x] Package skeletons: `shared`, `server` (Fastify + health endpoint), `web` (Vite + React + Tailwind, `/api` proxy)
- [x] Root scripts: `pnpm dev` starts everything, `pnpm test` runs all tests, `pnpm typecheck`

### Phase 1 — Shared package (~20 min)
- [x] Domain types: `AuctionSnapshot`, `SellerSnapshot`, `Bid`, `PlaceBidResponse`, rejection reasons, `ApiError`
- [x] zod schemas: create-auction input (price > 0, increment > 0, end time in the future — schema built per request with `now`), bid input, `toFieldErrors`
- [x] Money helpers: `parseEuroToCents`, `formatCents`, `centsToInputValue` + unit tests (edge cases: `"0.29"`, `"1,50"`, `"abc"`, 3 decimals, thousands separators)

### Phase 2 — Server core (~45 min)
- [x] SQLite schema + migrations on startup (`PRAGMA user_version`)
- [x] Repository layer (prepared statements only)
- [x] Pure rules in `domain.ts` (`deriveStatus`, `minNextBid`, `evaluateBid`, `extendForAntiSniping`)
- [x] `AuctionService` with injected `Clock`: `createAuction`, `getSnapshot`, `getSellerSnapshot`, `placeBid` (one `BEGIN IMMEDIATE` transaction), `liveAuctions`
- [x] Seller key stored only as SHA-256 hash, compared with `timingSafeEqual`
- [x] Domain + service tests: TOO_LOW / OUTBID / AUCTION_ENDED, anti-sniping boundaries (30.001s vs 30s, chained extensions), first bid at starting price, main flow, same-moment bids, persistence across restart (file DB)
- [x] Mutation check: breaking the end-time rule, anti-sniping or OUTBID detection each makes tests fail

### Phase 3 — API, real-time, resilience (~45 min)
- [x] Fastify routes + zod validation with per-field error messages (bids: 201 accepted / 409 rejected, both with snapshot)
- [x] SSE hub (per-auction subscribers, public + seller streams, heartbeat, `retry: 2000`)
- [x] End-timer scheduler, rebuilt on startup (`setTimeout` delays > 2^31-1 ms (~24.8 days) fire immediately — clamped and re-checked on fire)
- [x] `forceCloseConnections` so open SSE streams don't block shutdown
- [x] Integration tests (real HTTP on a random port + SQLite):
  - [x] main flow: create → 2 bidders, several bids → time passes → winner declared
  - [x] simultaneous bids: 20 parallel identical bids → exactly 1 accepted; 50 parallel random bids → accepted bids strictly increase by the increment
  - [x] bid after end → 409 AUCTION_ENDED
  - [x] anti-sniping: bid at T-10s → `endsAt = bidTime + 30s`, pushed to every watcher
  - [x] restart: close app mid-auction, reopen same DB file → same state, winner, and the "ended" push still arrives
  - [x] validation errors (400), malformed JSON (400), unknown auction (404), wrong seller key (403)
- [x] Smoke test through the Vite proxy: SSE is not buffered

### Phase 4 — Web (~60 min)
- [x] Create page with client-side validation (shared zod schema) + server field errors; duration presets
- [x] Links live on the seller page (bidder link + private seller link, copy buttons); creation redirects there
- [x] Bidder page: name gate (persisted), item, current bid + leader, min next bid, countdown, recent history, bid form pre-filled with min next bid, feedback for accept / TOO_LOW / OUTBID / ENDED, "you've been outbid" notice
- [x] Seller page: live list of all bids (who / how much / when), countdown
- [x] Result view: "Sold to X for €Y" / "Ended without bids", "You won" / "You lost" (by bidder id, survives reload)
- [x] `useAuctionStream` hook: SSE + server-time offset, retry on 5xx, heartbeat watchdog for half-open connections
- [x] Countdown shows "Closing…" at zero until the server confirms the end; "Extended by a late bid" hint
- [x] Pure view logic (`pickNewer`, `bidderStanding`, `formatRemaining`) unit-tested
- [x] Browser check (Playwright, isolated contexts for two bidders): validation messages, create, TOO_LOW, outbid notice, anti-sniping extension seen by seller, reload keeps name/state, won/lost/sold, server killed for 30 s and restarted → page recovers by itself, mobile layout

### Phase 5 — Manual check (~15 min)
- [x] Two browsers + seller tab: full flow, reload mid-auction, kill server mid-auction, anti-sniping visible to all (done during phase 4, see above)

### Phase 6 — Docs (~15 min)
- [x] README: architecture, concurrency & time, tests, limitations, AI usage (models/tools, agent setup, one case where the agent was wrong)

### Phase 7 — Extras (separate commits each)
- [x] Landing page (UX change requested after phase 6): big "Live Auction" title, one display
      name, two buttons — **Bid on an auction** → live list, **Create an auction** → create page.
      Both need a name; the name is also stored as the seller name ("Offered by …", migration 2).
- [x] List of live auctions (`/auctions`): real-time via its own SSE stream, cards with title,
      seller, current price, bid count, countdown; ended auctions drop off by themselves (+ tests)
- [x] Redesign (requested): clean iOS-like "liquid glass" theme — frosted panels, system font,
      iOS blue accent, separate red for errors, floating glass header
- [x] Toasts (react-toastify) for every piece of user feedback, in addition to the inline
      messages; ids on repeatable toasts (outbid, connection, new bid) to avoid piles
- [x] Fix: long unbroken text (title / description / name) pushed the auction page wider than
      the screen — `wrap-anywhere` on user text, `min-w-0` on grid columns; checked at 1280 px
      and 390 px
- [x] Pointer cursor on everything clickable (global base style; disabled buttons keep `not-allowed`)
- [x] Ended auctions listed below the running ones on `/auctions` (requested): result
      ("Sold to X for €Y" / "Ended without bids"), most recent first; an auction moves from the
      top list to the bottom one by itself when it ends. Endpoint renamed `/api/live-auctions` →
      `/api/lobby` since it is no longer only live auctions (+ tests)
- [ ] Seller can end early, only before the first bid (+ test)
- [ ] Outbid cue (sound + flash); the outbid toast already covers part of it

## AI-validation log

Running notes for the README's "Validation" section — record every case where the agent's
output was wrong or weak, how it was caught and what changed.

- **Package depending on itself (phase 0).** While installing packages, the agent accidentally
  added the shared package as a dependency of itself. I noticed it in the `package.json` diff
  and removed it.
- **A test that didn't test anything (phase 2).** One of the concurrency tests looked fine by its
  name, but the code inside was nonsense: wrong bid amount, and it expected a bid to be accepted
  that would actually be rejected. I spotted it while reading through the tests before running
  them, and had it rewritten as a clear three-bidder scenario.
- **All tests passed on the first try — suspicious (phase 2).** Instead of trusting it, I broke
  three rules on purpose (bids allowed at the exact end time, anti-sniping turned off, "outbid"
  never reported) and checked that the tests caught it. They did, every time, so I kept them.
- **The restart test forgot about anti-sniping (phase 3).** The agent wrote a test where someone
  bids 1.5 seconds before the end, then expected the auction to end right after. But a bid that
  late pushes the end out by 30 seconds — exactly as it should — so the test failed. The code was
  right, the test was wrong. Fixed the test so the bid comes early enough not to extend the end.
- **A pointless check slipped in (phase 3).** While fixing that test, the agent added a "sanity
  check" that compared a value with itself, so it could never fail. I caught it when reviewing
  the change and replaced it with a real check.
- **The page didn't survive a server restart (phase 4).** All automated tests passed, but when I
  actually restarted the server in the browser test, the page broke in two ways. First, it showed
  "Could not connect" and gave up for good, because the dev proxy answers with an error while the
  server is down and the browser's live connection treats that as final. Second, a page that was
  already open kept showing "Live" while receiving nothing, because the proxy kept a dead
  connection open. The agent's design assumed the browser would always reconnect by itself. Fixed
  with retries on server errors and a heartbeat: the server pings every 10 seconds, and the page
  reconnects if it hears nothing for 25 seconds. Re-tested by killing the server for 30 seconds:
  the page switched to "Reconnecting…" and came back with the latest bids on its own.
- **The name was forgotten after clicking "Bid" (phase 7).** On the new landing page I typed a
  name and clicked the button, and the next page asked for my name again. The agent saved the
  name inside a React state update that only runs on the next render — but the page had already
  navigated away, so it never ran. On top of that, every component had its own copy of the
  name. Fixed by keeping the name in one shared place that saves immediately. Caught only in the
  browser; the unit tests could not see it.
- **A reverted change left the database out of step (phase 7).** I had started a different
  extra and then asked to undo it. The code was reverted, but in the meantime an old dev server
  the agent thought it had stopped was still running in the background, restarted itself on the
  file change and applied the half-finished database migration. The next migration was then
  skipped and the server crashed on startup. Caught because the live list showed "Reconnecting…";
  the server log said a column was missing. Fixed by stopping every leftover process (there were
  four), moving the dev database aside, and from now on stopping dev servers by process, not by
  port.
- **A long description broke the page.** I noticed that a long comment without spaces pushed the
  auction page off the screen — in the browser it became almost four times wider than the
  window. The agent had only ever tested with normal sentences. Fixed so long words wrap inside
  their card, and re-checked on desktop and phone width with a deliberately silly 400-character
  word.
- **The new toast styling was silently ignored (redesign).** The toasts came out plain white and
  on top of the header instead of glassy and below it. The toast library loads its own styles
  after ours and overrode the settings. Spotted on the screenshot, fixed by applying the
  settings where the library can't override them.
