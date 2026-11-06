import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { renderExtensionLocales } from "./extension-locales";

const ROOT = join(import.meta.dir, "../..");

test("the extension's _locales match packages/i18n", async () => {
  const rendered = await renderExtensionLocales();
  const drifted: string[] = [];
  for (const [path, contents] of rendered) {
    const committed = await Bun.file(join(ROOT, path))
      .text()
      .catch(() => "");
    if (committed !== contents) {
      drifted.push(path);
    }
  }
  // Regenerate with: bun --no-env-file run scripts/repo/extension-locales.ts --write
  expect(drifted).toEqual([]);
  // No folder for a language Teak doesn't translate.
  const folders = readdirSync(join(ROOT, "apps/extension/public/_locales"))
    .map((folder) => `apps/extension/public/_locales/${folder}/messages.json`)
    .sort();
  expect(folders).toEqual([...rendered.keys()].sort());
});
