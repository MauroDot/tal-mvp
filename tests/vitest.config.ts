import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // Rules-unit-testing spins up a real emulator connection per test file;
    // give it more headroom than vitest's 5s default.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
