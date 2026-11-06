import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CRONS, cronTasksOn } from "@teak/convex/cronSchedules";
import { V1_ENDPOINTS } from "@teak/convex/publicApi/http/meta";

// Checks that the backend's own definitions match files in other workspaces:
// the Core Worker's Wrangler configs, the API docs page and the deploy
// workflow. They live here, with the other repository checks, because these
// tests read the whole tree.

const ROOT = join(import.meta.dir, "../..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

describe("Core Worker Cron Triggers", () => {
  const triggerCrons = (file: string): string[] =>
    (
      Bun.JSONC.parse(read(file)) as {
        triggers?: { crons?: string[] };
      }
    ).triggers?.crons ?? [];

  test.each([
    "apps/core-worker/wrangler.jsonc",
    "apps/core-worker/development/wrangler.jsonc",
    "apps/core-worker/self-host/wrangler.jsonc",
  ])(
    "the Cloudflare tasks' schedules are exactly the Cron Triggers in %s",
    (file) => {
      const schedules = new Set(
        cronTasksOn("cloudflare").map((task) => CRONS[task].schedule)
      );
      expect([...new Set(triggerCrons(file))].sort()).toEqual(
        [...schedules].sort()
      );
    }
  );
});

test("the API page documents every /v1 method and path", () => {
  const docs = read("apps/docs/content/docs/(developers)/api.mdx");
  const tableRow = (path: string) =>
    docs.split("\n").find((line) => line.startsWith(`| \`${path}\` |`)) ?? "";
  const undocumented = V1_ENDPOINTS.filter((endpoint) => {
    const [method = "", path = ""] = endpoint.split(" ");
    return !(docs.includes(endpoint) || tableRow(path).includes(method));
  });
  expect(docs).toContain("/openapi.json");
  expect(undocumented).toEqual([]);
});

test("the backend deploy typechecks regenerated declarations without a hoisted-typescript symlink", () => {
  const workflow = read(".github/workflows/backend-deploy.yml");
  expect(workflow).toContain("bunx convex codegen");
  expect(workflow).toContain("bun run typecheck");
  expect(workflow).toContain("--typecheck disable");
  expect(workflow).not.toContain(
    'ln -s "$GITHUB_WORKSPACE/node_modules/typescript" node_modules/typescript'
  );
  expect(workflow).not.toContain("--typecheck-components");
});
