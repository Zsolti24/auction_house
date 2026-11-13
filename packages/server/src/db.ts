import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = Database.Database;

/**
 * Ordered schema migrations. The index + 1 is stored in PRAGMA user_version, so each one runs
 * exactly once per database file. Never edit an existing entry — append a new one.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE auctions (
    id                   TEXT PRIMARY KEY,
    seller_key_hash      TEXT    NOT NULL,
    title                TEXT    NOT NULL,
    description          TEXT    NOT NULL,
    starting_price_cents INTEGER NOT NULL CHECK (starting_price_cents > 0),
    min_increment_cents  INTEGER NOT NULL CHECK (min_increment_cents > 0),
    created_at           INTEGER NOT NULL,
    ends_at              INTEGER NOT NULL
  );

  CREATE TABLE bids (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT, -- insertion order, tie-breaker for equal timestamps
    id           TEXT    NOT NULL UNIQUE,
    auction_id   TEXT    NOT NULL REFERENCES auctions(id),
    bidder_id    TEXT    NOT NULL,
    bidder_name  TEXT    NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX bids_by_auction ON bids (auction_id, seq);
  `,
];

/** Opens (and creates/migrates if needed) a database. Use ":memory:" for tests. */
export function openDatabase(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
