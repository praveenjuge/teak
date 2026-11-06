import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

// The one record of Teak's production Convex deployment. These files carry a
// copy because their formats can't import it: workflow and XcodeGen YAML,
// Gradle, Wrangler and Vercel config, the generated Xcode project and Worker
// types, docs, and tests that pin production's behavior.
const COPIES = [
  ".github/workflows/apple-release.yml",
  ".github/workflows/extension-release.yml",
  ".github/workflows/unit-tests.yml",
  "apps/android/app/build.gradle.kts",
  "apps/apple/Packages/TeakKit/Tests/TeakCoreTests/UploadTests.swift",
  "apps/apple/Teak.xcodeproj/project.pbxproj",
  "apps/apple/project.yml",
  "apps/core-worker/src/edge/apiProxy.test.ts",
  "apps/core-worker/worker-configuration.d.ts",
  "apps/core-worker/wrangler.jsonc",
  "apps/docs/content/docs/(apps)/extension.mdx",
  "apps/extension/release.md",
  "apps/web/src/lib/__tests__/securityHeaders.test.ts",
  "packages/convex/__tests__/mcp/httpServer.test.ts",
  "packages/convex/__tests__/publicApi/http/gateway.test.ts",
  "packages/convex/vercel.json",
  "scripts/dev/core-worker-dev-boundary.test.ts",
  "scripts/deployments.json",
].sort();

interface Deployments {
  production: { convexUrl: string; name: string; siteUrl: string };
}

const deployments = JSON.parse(
  readFileSync(join(ROOT, "scripts/deployments.json"), "utf8")
) as Deployments;

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
  // A copy changed to another deployment drops out of this list; a new copy
  // shows up in it.
  expect(filesNaming(deployments.production.name)).toEqual(COPIES);
});
