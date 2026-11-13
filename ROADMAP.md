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
   - leading bid changed since the client's `expectedLeadingBidId` → `OUTBID`
   - otherwise → `TOO_LOW`
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
| `GET /api/auctions?live=1` | *Extra*: list of live auctions |

Every SSE message is a full snapshot, not a diff, so clients can never drift from the
server state; reconnect = fresh state.

## Phases

### Phase 0 — Setup (~25 min)
- [x] `git init`, remote, `ROADMAP.md`, `CLAUDE.md`
- [x] pnpm workspace, shared `tsconfig.base.json`, `.gitignore`
- [x] Package skeletons: `shared`, `server` (Fastify + health endpoint), `web` (Vite + React + Tailwind, `/api` proxy)
- [x] Root scripts: `pnpm dev` starts everything, `pnpm test` runs all tests, `pnpm typecheck`

### Phase 1 — Shared package (~20 min)
- [ ] Domain types: `AuctionSnapshot`, `Bid`, `BidResult`, rejection reasons
- [ ] zod schemas: create-auction input (price > 0, increment > 0, end time in the future), bid input
- [ ] Money helpers: `parseEuroToCents`, `formatCents` + unit tests (edge cases: `"0.1"`, `"1,50"`, `"abc"`, 3 decimals)

### Phase 2 — Server core (~45 min)
- [ ] SQLite schema + migrations on startup
- [ ] Repository layer
- [ ] `AuctionService` with injected `Clock`: `create`, `getSnapshot`, `placeBid`
- [ ] Domain tests: TOO_LOW / OUTBID / AUCTION_ENDED, anti-sniping boundaries (30.001s vs 30s), first bid at starting price

### Phase 3 — API, real-time, resilience (~45 min)
- [ ] Fastify routes + zod validation with per-field error messages
- [ ] SSE hub (per-auction subscribers, heartbeat)
- [ ] End-timer scheduler, rebuilt on startup
- [ ] Integration tests (real HTTP + SQLite):
  - [ ] main flow: create → 2 bidders, several bids → time passes → winner declared
  - [ ] simultaneous bids: N parallel identical bids → exactly 1 accepted
  - [ ] bid after end → rejected
  - [ ] anti-sniping: bid at T-10s → `endsAt = bidTime + 30s`
  - [ ] restart: close app, reopen same DB file → same state and winner
  - [ ] validation errors (400) and wrong seller key (403)

### Phase 4 — Web (~60 min)
- [ ] Create page with client-side validation + server error display
- [ ] "Links" page: bidder link + seller link, copy buttons
- [ ] Bidder page: name gate (persisted), item, current bid + leader, min next bid, countdown, recent history, bid form pre-filled with min next bid, feedback for accept / TOO_LOW / OUTBID / ENDED, "you've been outbid" banner
- [ ] Seller page: live list of all bids (who / how much / when), countdown
- [ ] Result view: "Sold to X for €Y" / "Ended without bids", "You won" / "You lost"
- [ ] `useAuctionStream` hook: SSE + server-time offset

### Phase 5 — Manual check (~15 min)
- [ ] Two browsers + seller tab: full flow, reload mid-auction, kill server mid-auction, anti-sniping visible to all

### Phase 6 — Docs (~15 min)
- [ ] README: architecture, concurrency & time, tests, limitations, AI usage (models/tools, agent setup, one case where the agent was wrong)

### Phase 7 — Extras (separate commits each)
- [ ] Seller can end early, only before the first bid (+ test)
- [ ] List of live auctions
- [ ] Outbid cue (sound + visual)

## AI-validation log

Running notes for the README's "Validation" section — record every case where the agent's
output was wrong or weak, how it was caught and what changed.

-
