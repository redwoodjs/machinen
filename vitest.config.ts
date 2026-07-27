import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/__tests__/**/*.test.ts",
      "apps/machinen-desktop-services/src/**/*.test.ts",
    ],
    setupFiles: ["./vitest.setup.ts"],
    // Several runtime suites build the Zig helper in beforeAll(). GitHub
    // release runners can spend >10s there when tests start in parallel.
    hookTimeout: 60_000,
  },
});
