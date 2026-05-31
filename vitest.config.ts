/**
 * Vitest configuration for unit tests.
 * Excludes *.ai.test.ts and legacy aiHandler test files which are designed
 * for the elasticdash test runner and have unresolvable imports in vitest.
 *
 * The `@/*` resolver mirrors tsconfig.json paths so source files that use
 * `@/utils/...` style imports resolve correctly inside vitest as well.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/*.ai.test.ts",
      "**/test/aiHandler.*.test.ts",
    ],
  },
});
