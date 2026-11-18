import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS = join(import.meta.dir, "../../.github/workflows");

test("Apple releases queue behind each other instead of running at once", () => {
  // Both platforms ship to one App Store app and allocate build numbers from
  // its whole history, so two runs at once could take the same number. Queued
  // runs only wait for runs in the same group, so the group name can't change
  // while a run is queued, and a version can't be part of it.
  const workflow = Bun.YAML.parse(
    readFileSync(join(WORKFLOWS, "apple-release.yml"), "utf8")
  ) as { concurrency: unknown };
  expect(workflow.concurrency).toEqual({
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not a JS template.
    group: "mobile-app-store-ios-${{ github.repository }}",
    "cancel-in-progress": false,
  });
});
