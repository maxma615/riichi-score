import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/legacy/unit/*.test.ts"],
    maxWorkers: 1,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
