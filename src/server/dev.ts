import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import type { ViteDevServer } from "vite";
import { createPersistentApi } from "./app/api.ts";

const app = new Hono<{ Bindings: { vite: ViteDevServer } }>();
// The native sidecar owns startup migration; Vite must not restart the same engine again.
const api = createPersistentApi({ migrateHostGateway: false });

app.route("/api", api);
app.get("*", async (context) => {
  const source = await readFile("index.html", "utf8");
  const html = await context.env.vite.transformIndexHtml(context.req.path, source);
  return context.html(html);
});

export default app;
