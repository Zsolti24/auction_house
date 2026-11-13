# Live Auction House

A small real-time auction app: a seller creates an auction and shares a link, bidders compete live,
and the server decides who wins. Built for the Square21 fullstack engineering assessment.

**Stack:** TypeScript · pnpm workspaces · Node + Fastify · SQLite (`better-sqlite3`) · REST + Server-Sent Events · React + Vite + Tailwind · Vitest

> 🚧 **Work in progress.** The phased plan, design decisions and progress checklist are in
> [ROADMAP.md](ROADMAP.md). This README will be completed when the implementation is done.

## Running it

Requirements: Node.js ≥ 20 and pnpm (the exact version is pinned in `package.json`; run
`corepack enable` once and corepack will use it).

```bash
pnpm install     # install all packages
pnpm dev         # start server (http://localhost:3001) and web app (http://localhost:5173)
pnpm test        # run all tests
pnpm typecheck   # type-check all packages
```

## Repository layout

```
packages/
  shared/   domain types, validation schemas (zod), money helpers — used by server and web
  server/   Fastify API, bidding rules, SQLite persistence, SSE
  web/      React frontend
```

## Architecture and key decisions

_TODO — see [ROADMAP.md](ROADMAP.md#decisions) for now._

## Concurrency and time

_TODO — see [ROADMAP.md](ROADMAP.md#bid-algorithm-single-sqlite-transaction) for now._

## Tests

_TODO_

## Known limitations and what I'd improve

_TODO_

## AI usage

_TODO — models and tools, agent setup ([CLAUDE.md](CLAUDE.md)), and validation of agent output.
Cases where the agent was wrong are logged as they happen in the
[AI-validation log](ROADMAP.md#ai-validation-log)._
