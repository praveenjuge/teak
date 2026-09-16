import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditDotenv,
  buildDotenvReport,
  hasDotenvErrors,
} from "./dotenv-audit.ts";

const POISON_DEPLOY_KEY = "-poison-deploy-key-value-9f3c";
const POISON_PASSWORD = "poison-e2e-password-7a1e";

let roots: string[] = [];
afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots = [];
});

const makeRoot = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), "teak-dotenv-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
};

const kinds = (root: string): string[] =>
  auditDotenv(root).map(
    (finding) =>
      `${finding.severity}:${finding.kind}:${finding.path}:${finding.name}`
  );

describe("dotenv-audit", () => {
  test("clean tree reports no findings", () => {
    const root = makeRoot({
      "apps/web/.env.local":
        "NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210\nNEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211\n",
    });
    expect(auditDotenv(root)).toEqual([]);
  });

  test("deleted aliases are errors", () => {
    const root = makeRoot({
      "apps/web/.env.local": "PROD_SITE_URL=https://example.com\n",
    });
    expect(kinds(root)).toContain(
      "error:deleted-alias:apps/web/.env.local:PROD_SITE_URL"
    );
    expect(hasDotenvErrors(auditDotenv(root))).toBe(true);
  });

  test("production selectors in local files are errors", () => {
    const root = makeRoot({
      "packages/convex/.env.local":
        "CONVEX_DEPLOYMENT=prod:restless-giraffe-123\n",
      "apps/web/.env.local": `CONVEX_DEPLOY_KEY=${POISON_DEPLOY_KEY}\n`,
    });
    const found = kinds(root);
    expect(found).toContain(
      "error:production-selector:packages/convex/.env.local:CONVEX_DEPLOYMENT"
    );
    expect(found).toContain(
      "error:production-selector:apps/web/.env.local:CONVEX_DEPLOY_KEY"
    );
  });

  test("legacy root dotenv production selectors are warnings", () => {
    const root = makeRoot({
      ".env.local": `CONVEX_DEPLOY_KEY=${POISON_DEPLOY_KEY}\n`,
    });
    expect(kinds(root)).toEqual([
      "warn:production-selector:.env.local:CONVEX_DEPLOY_KEY",
    ]);
    expect(hasDotenvErrors(auditDotenv(root))).toBe(false);
  });

  test("e2e scope files may hold production selectors", () => {
    const root = makeRoot({
      ".env.production-e2e.local": `CONVEX_DEPLOY_KEY=${POISON_DEPLOY_KEY}\nPROD_E2E_PASSWORD=${POISON_PASSWORD}\n`,
      "apps/web/.env.e2e.local": `E2E_TEST_PASSWORD=${POISON_PASSWORD}\n`,
    });
    expect(auditDotenv(root)).toEqual([]);
  });

  test("e2e credentials in the web build input are wrong-scope", () => {
    const root = makeRoot({
      "apps/web/.env.local": `E2E_TEST_PASSWORD=${POISON_PASSWORD}\n`,
    });
    expect(kinds(root)).toContain(
      "warn:wrong-scope:apps/web/.env.local:E2E_TEST_PASSWORD"
    );
  });

  test("release-only credentials in local files are wrong-scope", () => {
    const root = makeRoot({
      "apps/desktop/.env.local": "SENTRY_AUTH_TOKEN=lorem\n",
    });
    expect(kinds(root)).toContain(
      "warn:wrong-scope:apps/desktop/.env.local:SENTRY_AUTH_TOKEN"
    );
  });

  test("unknown keys are stale-key warnings", () => {
    const root = makeRoot({
      "apps/web/.env.local": "TEAK_TYPO_VARNAME=oops\n",
    });
    expect(kinds(root)).toContain(
      "warn:stale-key:apps/web/.env.local:TEAK_TYPO_VARNAME"
    );
  });

  test("report never contains secret values", () => {
    const root = makeRoot({
      ".env.local": `CONVEX_DEPLOY_KEY=${POISON_DEPLOY_KEY}\n`,
      "apps/web/.env.local": `E2E_TEST_PASSWORD=${POISON_PASSWORD}\nCONVEX_DEPLOYMENT=prod:should-stay-hidden\n`,
      ".env.production-e2e.local": `PROD_E2E_PASSWORD=${POISON_PASSWORD}\n`,
    });
    const serialized = JSON.stringify(buildDotenvReport(root));
    expect(serialized).not.toContain(POISON_DEPLOY_KEY);
    expect(serialized).not.toContain(POISON_PASSWORD);
    expect(serialized).not.toContain("prod:should-stay-hidden");
    expect(serialized).toContain("CONVEX_DEPLOY_KEY");
  });
});
