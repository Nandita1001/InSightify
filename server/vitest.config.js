import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.js"],
    testTimeout: 30_000,
    hookTimeout: 60_000,           // first run downloads ~120MB Mongo binary
    fileParallelism: false,        // shared in-memory Mongo across files
    globals: false,
  },
});
