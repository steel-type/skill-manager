import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Service modules are pure Node code; no DOM needed.
    environment: "node",
    include: [
      "electron/**/*.test.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
    // Keep tests deterministic — single fork avoids tmpdir races.
    pool: "forks",
    fileParallelism: false,
  },
});
