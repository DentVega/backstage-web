import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // scripts/*.test.mjs use Node's built-in `node:test` runner (bootstrap tool),
    // not vitest — vitest can't bundle `node:test`. They run via `node --test`.
    exclude: [...configDefaults.exclude, "scripts/**"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
