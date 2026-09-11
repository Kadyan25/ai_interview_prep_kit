import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Nothing here may reach the network or a real model.
    testTimeout: 20_000,
    passWithNoTests: true,
  },
});
