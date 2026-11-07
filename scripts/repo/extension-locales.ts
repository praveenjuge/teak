#!/usr/bin/env bun
// Builds the browser extension's manifest strings
// (apps/extension/public/_locales/<locale>/messages.json) from the
// `extension.manifest` messages in packages/i18n, as apps/apple/scripts/i18n.ts
// does for the Safari extension. extension-locales.test.ts checks the
// committed files match. Regenerate with:
//   bun --no-env-file run scripts/repo/extension-locales.ts --write
import { join } from "node:path";
import { flattenCatalog } from "../../packages/i18n/src/catalog";
import {
  extensionLocaleDir,
  SUPPORTED_LOCALES,
} from "../../packages/i18n/src/locales";

const ROOT = join(import.meta.dir, "../..");
const PREFIX = "extension.manifest.";

/**
 * Each manifest message (`__MSG_<name>__` in wxt.config.ts), its catalog key,
 * and the note the stores' translators see.
 */
const MANIFEST_MESSAGES = [
  {
    name: "extName",
    key: "name",
    description: "The extension's name. Keep it as Teak in every language.",
  },
  {
    name: "extDescription",
    key: "description",
    description:
      "The extension's description in the browser's extension list and store.",
  },
  {
    name: "saveCommand",
    key: "saveCommand",
    description:
      "The keyboard shortcut's name in the browser's extension shortcuts settings.",
  },
] as const;

export const localesFile = (locale: string): string =>
  `apps/extension/public/_locales/${locale}/messages.json`;

export const renderExtensionLocales = async (): Promise<
  Map<string, string>
> => {
  const files = new Map<string, string>();
  for (const locale of SUPPORTED_LOCALES) {
    const catalog = flattenCatalog(
      await Bun.file(join(ROOT, `packages/i18n/messages/${locale}.json`)).json()
    );
    const messages = Object.fromEntries(
      MANIFEST_MESSAGES.map(({ name, key, description }) => {
        const message = catalog.get(PREFIX + key);
        if (!message) {
          throw new Error(`${locale} has no ${PREFIX}${key}`);
        }
        // Browsers read `$name$` placeholders, not ICU's `{name}`.
        if (/[{}$]/.test(message)) {
          throw new Error(
            `${locale} ${PREFIX}${key}: manifest text can't have placeholders`
          );
        }
        return [name, { message, description }];
      })
    );
    files.set(
      localesFile(extensionLocaleDir(locale)),
      `${JSON.stringify(messages, null, 2)}\n`
    );
  }
  return files;
};

if (import.meta.main) {
  for (const [path, contents] of await renderExtensionLocales()) {
    if (process.argv.includes("--write")) {
      await Bun.write(join(ROOT, path), contents);
      console.log(`Wrote ${path}`);
    } else {
      console.log(`${path}: ${contents.length} bytes`);
    }
  }
}
