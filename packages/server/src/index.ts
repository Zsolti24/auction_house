import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 3001);
const app = buildApp();

app.listen({ port, host: "127.0.0.1" }).then(
  () => console.log(`Server listening on http://127.0.0.1:${port}`),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
