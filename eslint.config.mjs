import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // functions/ is a separate TS project (own package.json, tsconfig,
    // node_modules) for Cloud Functions — lint it via `cd functions && npx eslint`
    // (or its own config) rather than sweeping it into the Next.js app's lint.
    "functions/**",
  ]),
]);

export default eslintConfig;
