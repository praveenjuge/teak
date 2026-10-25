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
      return [".build", "build", "Tests", "TeakUITests"].includes(entry.name)
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

  test("Siri phrases and Shortcuts summaries match the intent's source", async () => {
    const { messages } = await loadNativeCatalogs(
      resolve(APPLE, "../../packages/i18n/messages"),
      "apple"
    );
    const source = swiftFiles(join(APPLE, "Teak/Intents"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    // The system finds these by their English text, so the Swift literal must match it.
    const missing = [...messages.en]
      .filter(([key]) => /^apple\.(appShortcuts|intentSummaries)\./.test(key))
      .map(([key, english]) => [
        key,
        english
          .replace("{applicationName}", "\\(.applicationName)")
          .replaceAll(/\{(\w+)\}/g, "\\(\\.$$$1)"),
      ])
      .filter(([, swift]) => !source.includes(`"${swift}"`))
      .map(([key]) => key);
    expect(missing).toEqual([]);
  });

  test("views take their text from the catalog, not string literals", () => {
    // A literal here would be English in every language; read it with tr().
    const view =
      /\b(Text|Button|Label|Section|Toggle|Picker|Menu|TextField|SecureField|LabeledContent|ContentUnavailableView|navigationTitle|alert|confirmationDialog|help|accessibilityLabel|accessibilityHint|accessibilityValue|Tab|CommandMenu)\("([^"\\]*[A-Za-z][^"\\]*)"/g;
    const allowed = new Set(["Teak"]);
    const literals = swiftFiles(APPLE).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(view)]
        .filter((match) => !allowed.has(match[2] as string))
        .map((match) => `${relative(APPLE, file)}: ${match[0]}`)
    );
    expect(literals).toEqual([]);
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
