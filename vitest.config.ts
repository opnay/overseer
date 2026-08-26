import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/client", import.meta.url)),
      "@contracts": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    server: {
      deps: {
        inline: [/@opnay\/city-ds-react/],
      },
    },
    setupFiles: ["./tests/setup.ts"],
  },
});
