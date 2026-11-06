import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

// The one record of Teak's production Convex deployment. These files carry a
// copy because their formats can't import it: workflow and XcodeGen YAML,
// Gradle, Wrangler and Vercel config, the generated Xcode project and Worker
// types, docs, and tests that pin production's behavior.
// Each copy and how many times it names the deployment, so one URL in a file
// switched to another deployment fails even when the file still names it.
const COPIES: Record<string, number> = {
  ".github/workflows/apple-release.yml": 1,
  ".github/workflows/extension-release.yml": 4,
  ".github/workflows/unit-tests.yml": 2,
  "apps/android/app/build.gradle.kts": 1,
  "apps/apple/Packages/TeakKit/Tests/TeakCoreTests/UploadTests.swift": 1,
  "apps/apple/Teak.xcodeproj/project.pbxproj": 1,
  "apps/apple/project.yml": 1,
  "apps/core-worker/src/edge/apiProxy.test.ts": 1,
  "apps/core-worker/worker-configuration.d.ts": 2,
  "apps/core-worker/wrangler.jsonc": 2,
  "apps/docs/content/docs/(apps)/extension.mdx": 2,
  "apps/extension/release.md": 4,
  "apps/web/src/lib/__tests__/securityHeaders.test.ts": 1,
  "packages/convex/__tests__/mcp/httpServer.test.ts": 1,
  "packages/convex/__tests__/publicApi/http/gateway.test.ts": 1,
  "packages/convex/vercel.json": 1,
  "scripts/deployments.json": 3,
  "scripts/dev/core-worker-dev-boundary.test.ts": 5,
};

interface Deployments {
  production: { convexUrl: string; name: string; siteUrl: string };
}

const deployments = JSON.parse(
  readFileSync(join(ROOT, "scripts/deployments.json"), "utf8")
) as Deployments;

const timesNamed = (text: string): Record<string, number> =>
  Object.fromEntries(
    filesNaming(text).map((file) => [
      file,
      readFileSync(join(ROOT, file), "utf8").split(text).length - 1,
    ])
  );

const filesNaming = (text: string): string[] =>
  new TextDecoder()
    .decode(
      Bun.spawnSync(
        ["git", "grep", "--files-with-matches", "--fixed-strings", text],
        { cwd: ROOT }
      ).stdout
    )
    .split("\n")
    .filter(Boolean)
    .sort();

test("the production deployment's URLs follow from its name", () => {
  const { name, convexUrl, siteUrl } = deployments.production;
  expect(convexUrl).toBe(`https://${name}.convex.cloud`);
  expect(siteUrl).toBe(`https://${name}.convex.site`);
});

test("every copy of the production deployment names the canonical one", () => {
  // A copy changed to another deployment lowers its count or drops out; a new
  // copy shows up.
  expect(timesNamed(deployments.production.name)).toEqual(COPIES);
});
