import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

// Teak's own PostHog project token. Self-hosted deployments must never send
// to it, so it may appear only in Teak's production Worker config, the types
// Wrangler generates from that config, and the internal analytics guide.
// Every other surface reads its token from its own deployment's env.
const ALLOWED = [
  ".agents/guides/analytics.md",
  "apps/core-worker/worker-configuration.d.ts",
  "apps/core-worker/wrangler.jsonc",
];

const teakToken = (): string => {
  const config = Bun.JSONC.parse(
    readFileSync(join(ROOT, "apps/core-worker/wrangler.jsonc"), "utf8")
  ) as { vars: { POSTHOG_PROJECT_TOKEN?: string } };
  const token = config.vars.POSTHOG_PROJECT_TOKEN ?? "";
  expect(token).toStartWith("phc_");
  return token;
};

test("Teak's PostHog token appears only in Teak's own production config and guide", () => {
  const found = Bun.spawnSync(
    ["git", "grep", "--files-with-matches", "--fixed-strings", teakToken()],
    { cwd: ROOT }
  );
  const files = new TextDecoder()
    .decode(found.stdout)
    .split("\n")
    .filter(Boolean)
    .sort();
  expect(files).toEqual(ALLOWED);
});
