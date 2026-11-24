import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/out/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.min.js",
      "pnpm-lock.yaml",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      // No stray console output in shipped code (warn, not error, so
      // one-off CLIs and scripts can keep it with a visible warning).
      "no-console": "warn",
      // Money is integer minor units + currency code, never floats.
      // parseFloat is the usual way a float sneaks into money math, so
      // it is banned repo-wide. If you genuinely need it for non-money
      // input (e.g. parsing a measurement), add an eslint-disable-next-line
      // with a comment explaining why the value is not money.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message:
            "Do not use parseFloat: money is integer minor units + currency code (see packages/shared/src/money.ts). Use Number.parseInt on integer input, or add an eslint-disable comment explaining why this value is not money.",
        },
      ],
    },
  },
  {
    // Generated / vendored code is not linted for style.
    files: ["**/prisma/migrations/**", "**/*.json"],
    rules: { "no-console": "off" },
  },
);
