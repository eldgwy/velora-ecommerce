import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import drizzlePlugin from "eslint-plugin-drizzle";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // T-4.4 hardening: UPDATE/DELETE through drizzle must always be scoped by
  // .where(...) — the low-stock ledger + audit work made partial writes a
  // correctness surface, so let the linter catch unbounded writes.
  {
    plugins: { drizzle: drizzlePlugin },
    rules: {
      "drizzle/enforce-delete-with-where": "error",
      "drizzle/enforce-update-with-where": "error",
    },
  },
  // T-4.4 hardening: page/layout components never touch the database or
  // infrastructure modules directly — they go through the application query
  // layer (route handlers under app/api are the sanctioned exception).
  {
    files: ["app/**/*.tsx"],
    ignores: ["**/api/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/infrastructure/*"],
              message:
                "Pages/layouts must rely on the application query layer; import infrastructure modules only from services/modules or route handlers.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
