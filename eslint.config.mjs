import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const ignores = [
  "node_modules/**",
  ".next/**",
  "out/**",
  "build/**",
  "dist/**",
  "public/**",
  "extension/**",
  "mobile/**",
  "next-env.d.ts",
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    ignores,
  },
]);
