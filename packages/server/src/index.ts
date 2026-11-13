import { join } from "node:path";
import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 3001);
const dbPath = process.env.DB_PATH ?? join(process.cwd(), "data", "auction.db");

const app = buildApp({ dbPath });

app.listen({ port, host: "127.0.0.1" }).then(
  () => console.log(`Server listening on http://127.0.0.1:${port} (db: ${dbPath})`),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close().finally(() => process.exit(0));
  });
}
