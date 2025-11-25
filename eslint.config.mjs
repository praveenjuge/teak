import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";
import globals from "globals";
import { defineConfig } from "eslint/config";

const ignores = [
  "node_modules/**",
  ".next/**",
  "out/**",
  "build/**",
  "dist/**",
  "public/**",
  "extension/**",
  "mobile/**",
  "convex/**",
  "next-env.d.ts",
];

const nextCore = nextPlugin.configs["core-web-vitals"];

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores,
    files: [
      "src/**/*.{ts,tsx}",
      "src/**/*.{js,jsx}",
      "src/tests/**/*.{ts,tsx}",
    ],
    plugins: {
      "@next/next": nextPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      ...nextCore.rules,
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "no-undef": "off",
    },
    ...(nextCore.settings ? { settings: nextCore.settings } : {}),
  },
]);
