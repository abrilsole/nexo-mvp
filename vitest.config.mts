import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Los tests de componentes (.test.tsx) usan JSX y corren en jsdom (se indica en cada archivo).
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      // Next resuelve "server-only" internamente; en los tests es un módulo vacío.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"] },
});
