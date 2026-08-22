import devServer from "@hono/vite-dev-server";
import nodeAdapter from "@hono/vite-dev-server/node";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    devServer({
      adapter: nodeAdapter,
      entry: "src/server/dev.ts",
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
  },
});
