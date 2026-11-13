import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against the real app: real server, real SQLite file, real Vite frontend.
 * They use their own ports and a fresh temporary database, so they never touch the dev
 * database and can run while `pnpm dev` is running.
 */
const API_PORT = 3101;
const WEB_PORT = 5174;
const dbPath = join(tmpdir(), `auction-e2e-${Date.now()}.db`);

export default defineConfig({
  testDir: "./tests",
  // Auctions take real seconds to end; each test creates its own auctions, so they can run side by side.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @auction/server exec tsx src/index.ts",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { PORT: String(API_PORT), DB_PATH: dbPath },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @auction/web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
