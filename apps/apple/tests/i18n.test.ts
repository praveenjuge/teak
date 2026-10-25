import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  checkTranslationCall,
  findTranslationCalls,
  loadNativeCatalogs,
} from "../../../packages/i18n/src/native";
import { renderAppleCatalogs } from "../scripts/i18n";

const APPLE = resolve(import.meta.dir, "..");

const swiftFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return [".build", "Tests", "TeakUITests"].includes(entry.name)
        ? []
        : swiftFiles(path);
    }
    return entry.name.endsWith(".swift") ? [path] : [];
  });

describe("Apple string catalogs", () => {
  test("match packages/i18n", async () => {
    const drifted: string[] = [];
    for (const [path, contents] of await renderAppleCatalogs()) {
      const committed = await Bun.file(join(APPLE, path))
        .text()
        .catch(() => "");
      if (committed !== contents) {
        drifted.push(path);
      }
    }
    // Regenerate with: bun --no-env-file run apps/apple/scripts/i18n.ts --write
    expect(drifted).toEqual([]);
  });

  test("every tr call names a key with the values its message takes", async () => {
    const { arguments: args } = await loadNativeCatalogs(
      resolve(APPLE, "../../packages/i18n/messages"),
      "apple"
    );
    const problems = swiftFiles(APPLE).flatMap((file) =>
      findTranslationCalls(readFileSync(file, "utf8"), ["tr"]).flatMap(
        (call) => {
          const problem = checkTranslationCall(call, args);
          return problem
            ? [`${relative(APPLE, file)}:${call.line} ${problem}`]
            : [];
        }
      )
    );
    expect(problems).toEqual([]);
  });
});
