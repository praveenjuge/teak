import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_TEAK_DEV_APP_URL,
  DEFAULT_TEAK_DEV_CONVEX_URL,
  DEFAULT_TEAK_DEV_DOCS_URL,
  TEAK_DEV_DEPLOYMENT_NAME,
} from "@teak/convex/devUrls";
import deployments from "../deployments.json" with { type: "json" };
import { MAIN_PORTS, MAIN_SITE_URL, webOrigins } from "../dev/worktree-env.ts";

const ROOT = join(import.meta.dir, "../..");

// scripts/deployments.json is the one record of Teak's Convex deployments and
// the main checkout's local ports. Code that can import it derives from it
// (scripts/dev/worktree-env.ts); the web app and docs derive the development
// deployment from packages/convex/devUrls.ts, which is checked against it
// below. The files listed here carry a copy because their formats can't
// import it: workflow and XcodeGen YAML, Gradle, Wrangler and Vercel config,
// the generated Xcode project and Worker types, docs, and tests that pin a
// deployment's behavior.
// Each copy and how many times it names the deployment, so one URL in a file
// switched to another deployment fails even when the file still names it.
const PRODUCTION_COPIES: Record<string, number> = {
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

const DEVELOPMENT_COPIES: Record<string, number> = {
  ".agents/runbooks/convex-costs.md": 3,
  ".agents/skills/verify-teak/SKILL.md": 2,
  ".agents/skills/verify-teak/features/api-cli-mcp.md": 4,
  ".agents/skills/verify-teak/features/claude-connector.md": 2,
  "apps/android/app/build.gradle.kts": 1,
  "apps/apple/Teak.xcodeproj/project.pbxproj": 1,
  "apps/apple/project.yml": 1,
  "apps/core-worker/README.md": 1,
  "apps/core-worker/development/wrangler.jsonc": 2,
  "apps/docs/content/docs/(open-source)/development.mdx": 3,
  "apps/raycast/src/__tests__/constants.test.ts": 1,
  "apps/raycast/src/__tests__/request.test.ts": 1,
  "apps/raycast/src/lib/constants.ts": 1,
  "apps/web/src/lib/__tests__/securityHeaders.test.ts": 3,
  "packages/convex/__tests__/authConfig.test.ts": 1,
  "packages/convex/__tests__/mcp/httpServer.test.ts": 2,
  "packages/convex/__tests__/publicApi/__snapshots__/contractSnapshot.test.ts.snap": 1,
  "packages/convex/__tests__/publicApi/http/gateway.test.ts": 1,
  "packages/convex/devUrls.ts": 1,
  "packages/convex/edge/workosDiscovery.test.ts": 1,
  "packages/sdk/src/workosConnect.test.ts": 2,
  "scripts/deployments.json": 3,
  "scripts/dev/core-worker-dev-boundary.test.ts": 1,
};

const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

const timesNamed = (text: string): Record<string, number> =>
  Object.fromEntries(
    filesNaming(text).map((file) => [file, read(file).split(text).length - 1])
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

describe.each([
  ["production", deployments.production, PRODUCTION_COPIES],
  ["development", deployments.development, DEVELOPMENT_COPIES],
] as const)("the %s deployment", (_, deployment, copies) => {
  test("its URLs follow from its name", () => {
    expect(deployment.convexUrl).toBe(
      `https://${deployment.name}.convex.cloud`
    );
    expect(deployment.siteUrl).toBe(`https://${deployment.name}.convex.site`);
  });

  test("every copy names the canonical one", () => {
    // A copy changed to another deployment lowers its count or drops out; a
    // new copy shows up.
    expect(timesNamed(deployment.name)).toEqual(copies);
  });
});

test("the backend's development defaults match the facts file", () => {
  expect(TEAK_DEV_DEPLOYMENT_NAME).toBe(deployments.development.name);
  expect(DEFAULT_TEAK_DEV_CONVEX_URL).toBe(deployments.development.convexUrl);
  expect(DEFAULT_TEAK_DEV_APP_URL).toBe(MAIN_SITE_URL);
  expect(DEFAULT_TEAK_DEV_DOCS_URL).toBe(`http://localhost:${MAIN_PORTS.docs}`);
});

test("the docs site and extension default to the main checkout's ports", () => {
  // `bun run dev` passes each worktree's ports; these defaults serve a bare
  // `bun run dev` inside the workspace.
  const devScript = (file: string): string =>
    (JSON.parse(read(file)) as { scripts: { dev: string } }).scripts.dev;
  expect(devScript("apps/docs/package.json")).toContain(
    `--port \${DOCS_PORT:-${MAIN_PORTS.docs}}`
  );
  expect(devScript("apps/extension/package.json")).toContain(
    `--port \${EXTENSION_PORT:-${MAIN_PORTS.extension}}`
  );
});

test("the docs state the main checkout's ports", () => {
  const p = MAIN_PORTS;
  expect(
    read("apps/docs/content/docs/(open-source)/development.mdx")
  ).toContain(
    `The main checkout keeps web ${p.web}, docs ${p.docs} and extension ${p.extension}.`
  );
  expect(read("apps/docs/content/docs/(open-source)/testing.mdx")).toContain(
    `The main checkout uses web ${p.web}, Convex ${p.convex}/${p.convexSite}, the emulator ${p.emulator}/${p.emulatorUpstream} and the Core Worker ${p.coreWorker} (its inspector on ${p.coreWorkerInspector})`
  );
});

test("WorkOS staging allows every web origin a checkout can run on", () => {
  // CORS origins can't use wildcards, so convex.json lists the main checkout's
  // origin and each slot a worktree can lease, and nothing else.
  const config = JSON.parse(read("packages/convex/convex.json")) as {
    authKit: { dev: { configure: { corsOrigins: string[] } } };
  };
  expect(config.authKit.dev.configure.corsOrigins).toEqual(webOrigins());
});
