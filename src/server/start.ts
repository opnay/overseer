import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { createPersistentApi } from "./api.ts";

const app = new Hono();
const api = createPersistentApi();

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      connectSrc: ["'self'"],
      defaultSrc: ["'self'"],
      fontSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  }),
);
app.route("/api", api);
app.use("*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

const requestedPort = Number(process.env.PORT ?? 0);
const port = Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : 0;

serve(
  {
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port,
  },
  (info) => {
    console.log(`Overseer: http://127.0.0.1:${info.port}`);
  },
);
