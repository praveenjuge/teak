import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { SUPPORTED_LOCALES } from "../../../packages/i18n/src/locales";
import {
  checkTranslationCall,
  findTranslationCalls,
  loadNativeCatalogs,
} from "../../../packages/i18n/src/native";
import { renderAndroidResources } from "../scripts/i18n";

const ANDROID = resolve(import.meta.dir, "..");

const kotlinFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["build", ".gradle", "test", "androidTest"].includes(entry.name)
        ? []
        : kotlinFiles(path);
    }
    return entry.name.endsWith(".kt") ? [path] : [];
  });

describe("Android string resources", () => {
  test("match packages/i18n", async () => {
    const drifted: string[] = [];
    for (const [path, contents] of await renderAndroidResources()) {
      const committed = await Bun.file(join(ANDROID, path))
        .text()
        .catch(() => "");
      if (committed !== contents) {
        drifted.push(path);
      }
    }
    // Regenerate with: bun --no-env-file run apps/android/scripts/i18n.ts --write
    expect(drifted).toEqual([]);
  });

  test("the system language list is exactly Teak's languages", () => {
    const config = readFileSync(
      join(ANDROID, "app/src/main/res/xml/locales_config.xml"),
      "utf8"
    );
    const listed = [...config.matchAll(/android:name="([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(listed).toEqual([...SUPPORTED_LOCALES]);
  });

  test("screens take their text from the catalog, not string literals", () => {
    // A literal here would be English in every language; read it with tr() or UiText.of().
    const ui =
      /\bText\("([^"$]*[A-Za-z][^"]*)"|\b(?:label|title|text|contentDescription|message|confirmLabel|dismissLabel|supporting|placeholder|actionLabel)\s*=\s*"([^"]*[A-Za-z][^"]*)"/g;
    // Names, key caps, search syntax people type, and animation labels nobody reads.
    const allowed = new Set([
      "Teak",
      "E",
      "tag:design type:link",
      "recordCorner",
    ]);
    const literals = kotlinFiles(ANDROID).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(ui)]
        .filter((match) => {
          const text = (match[1] ?? match[2]) as string;
          return !allowed.has(text);
        })
        .map((match) => `${relative(ANDROID, file)}: ${match[0]}`)
    );
    expect(literals).toEqual([]);
  });

  test("every tr and UiText.of call names a key with the values its message takes", async () => {
    const { arguments: args } = await loadNativeCatalogs(
      resolve(ANDROID, "../../packages/i18n/messages"),
      "android"
    );
    const problems = kotlinFiles(ANDROID).flatMap((file) =>
      findTranslationCalls(readFileSync(file, "utf8"), [
        "tr",
        "UiText.of",
      ]).flatMap((call) => {
        const problem = checkTranslationCall(call, args);
        return problem
          ? [`${relative(ANDROID, file)}:${call.line} ${problem}`]
          : [];
      })
    );
    expect(problems).toEqual([]);
  });
});
