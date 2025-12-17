import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import convexPlugin from "@convex-dev/eslint-plugin";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "node_modules/**",
    ".next/**",
    "out/**",
    "next-env.d.ts",
    "docs/.next/**",
    "docs/out/**",
    "docs/next-env.d.ts",
    "docs/.source/**",
    "convex/_generated/**",
    "extension/.output/**",
    "extension/.wxt/**",
    "mobile/dist/**",
    "mobile/.expo/**",
    "mobile/android/**",
    "mobile/ios/**",
    "mobile/metro.config.js",
  ]),
  ...nextVitals,
  ...nextTs,
  ...convexPlugin.configs.recommended,
  prettier,
  // Add no-floating-promises rule to catch unawaited promises (Convex best practice)
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: true,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    rules: {
      // Allow `any` in Convex server code and generated types.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);
