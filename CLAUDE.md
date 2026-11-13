# CLAUDE.md

Instructions for AI coding agents working in this repository.

## Project

Live Auction House: sellers create auctions, bidders bid in real time. Monorepo (pnpm workspaces):

- `packages/shared` — domain types, zod schemas, money helpers. Used by both server and web. No runtime deps besides zod.
- `packages/server` — Fastify + SQLite (`better-sqlite3`). REST for commands, SSE for pushes. Bidding rules in `src/domain.ts`.
- `packages/web` — React + Vite + Tailwind ("liquid glass" theme, tokens in `src/index.css`) + react-toastify. Vite proxies `/api` to the server.
- `packages/e2e` — Playwright browser tests against the real app.

Pages: `/` landing (name + Bid / Create), `/auctions` live + ended list, `/create`, `/a/:id` bidder, `/a/:id/seller?key=…` seller.

The plan, domain rules, phase checklist and the AI-validation log live in `ROADMAP.md`. Read it before starting a task, and tick off items when they are done. Keep `README.md` in sync when behaviour, commands or test counts change.

## Commands (run from repo root)

- `pnpm dev` — start server (port 3001) and web (port 5173)
- `pnpm test` — run all tests, including the browser tests (they start their own server on 3101 / web on 5174 with a temporary DB; first run downloads Chromium)
- `pnpm --filter @auction/e2e test` — only the browser tests (~1 minute, auctions end in real time)
- `pnpm typecheck` — type-check all packages

Node 22.12+ or 24+ (not 23 / 25). Before declaring a task done: `pnpm typecheck` and `pnpm test` must pass.

## Non-negotiable rules

- **The server decides.** All bid validation, ending, ending early and anti-sniping happen on the server. The client only displays snapshots it receives.
- **Money is integer cents** everywhere (`amountCents`, `startingPriceCents`). Never use floats for money. Parse user input as a string (`parseEuro`).
- **Time comes from an injected `Clock`** in server code. Never call `Date.now()` directly in domain/service code — tests must control time.
- **"Ended" is derived** from `now >= endsAt`, never stored as a status. Ending early moves `endsAt` to now (`ended_early` only records why).
- **Bids and end-early are each one synchronous SQLite transaction** (`BEGIN IMMEDIATE`): read state → validate → write. Do not introduce `await` inside it.
- **SSE messages are full snapshots**, never diffs. Every mutation publishes through `AuctionHub` (auction watchers + the lobby list).
- Validation schemas live in `shared` and are used on both sides.
- **Migrations are append-only** (`src/db.ts`, numbered by `PRAGMA user_version`). Never edit or renumber an existing one.

## UI conventions

- Every user-facing result is shown **inline and as a toast** (`notify`); repeatable toasts get an id.
- User-provided text (titles, descriptions, names) uses `wrap-anywhere`; grid children get `min-w-0`; prices use `fittedPriceSize` instead of wrapping. Check long input and the €1,000,000,000.00 maximum at 1280 px and 390 px.
- Sound only for "you've been outbid" — the one place the task asks for it.

## Working agreements

- **The human commits.** Do not run `git commit` or `git push` unless asked; end each piece of work with a suggested conventional commit message.
- **Verify, don't trust green.** Read generated tests before running them; for race tests, check that every branch actually happened (count outcomes). Check UI changes in a real browser, not only with unit tests.
- **Dev servers:** stop them by process (`node` processes whose command line contains this repo path), not by port — `tsx watch` parents survive a port kill and restart the server on the next file change.
- **When the agent gets something wrong**, add a short plain-language entry to the AI-validation log in `ROADMAP.md`: what went wrong, how it was caught, what changed.

## Conventions

- TypeScript strict mode; no `any` without a comment explaining why.
- Tests are written together with the logic, not afterwards. Time-dependent server tests use a fake clock, not real waiting.
- Small, focused commits with conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- Code, comments, commits and docs in English.
- Keep it simple: prefer clear code over abstractions.
