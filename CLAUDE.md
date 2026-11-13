# CLAUDE.md

Instructions for AI coding agents working in this repository.

## Project

Live Auction House: sellers create auctions, bidders bid in real time. Monorepo (pnpm workspaces):

- `packages/shared` — domain types, zod schemas, money helpers. Used by both server and web. No runtime deps besides zod.
- `packages/server` — Fastify + SQLite (`better-sqlite3`). REST for commands, SSE for pushes.
- `packages/web` — React + Vite + Tailwind. Vite proxies `/api` to the server.

The plan, domain rules and phase checklist live in `ROADMAP.md`. Read it before starting a task, and tick off items when they are done.

## Commands (run from repo root)

- `pnpm dev` — start server (port 3001) and web (port 5173)
- `pnpm test` — run all tests
- `pnpm typecheck` — type-check all packages

Before declaring a task done: `pnpm typecheck` and `pnpm test` must pass.

## Non-negotiable rules

- **The server decides.** All bid validation, ending and anti-sniping happen on the server. The client only displays snapshots it receives.
- **Money is integer cents** everywhere (`amountCents`, `startingPriceCents`). Never use floats for money. Parse user input as a string.
- **Time comes from an injected `Clock`** in server code. Never call `Date.now()` directly in domain/service code — tests must control time.
- **"Ended" is derived** from `now >= endsAt` (or `cancelledAt`), not stored as a flag that can drift.
- **A bid is one synchronous SQLite transaction**: read state → validate → insert → extend end time. Do not introduce `await` inside it.
- **SSE messages are full snapshots**, never diffs.
- Validation schemas live in `shared` and are used on both sides.

## Conventions

- TypeScript strict mode; no `any` without a comment explaining why.
- Tests are written together with the logic, not afterwards. Time-dependent tests use a fake clock, not real waiting.
- Small, focused commits with conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`, `docs:`).
- Code, comments, commits and docs in English.
- Keep it simple: this is a 3–4 hour assessment, not production. Prefer clear code over abstractions.
