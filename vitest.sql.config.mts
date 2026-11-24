import { defineConfig } from "vitest/config";

// SQL / RLS tests against a real PostgreSQL. Needs DATABASE_URL pointing at a
// server where we may create throwaway databases (default: local postgres).
export default defineConfig({
  test: {
    include: ["tests/sql/**/*.test.ts"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
