import devServer from "@hono/vite-dev-server";
import nodeAdapter from "@hono/vite-dev-server/node";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    devServer({
      adapter: nodeAdapter,
      entry: "src/server/dev.ts",
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/client", import.meta.url)),
      "@contracts": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
  },
});
