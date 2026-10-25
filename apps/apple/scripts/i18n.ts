/**
 * Generates the Apple app's string catalogs from packages/i18n. Regenerate
 * after changing a catalog there:
 *   bun --no-env-file run apps/apple/scripts/i18n.ts --write
 */
import { resolve } from "node:path";
import {
  extensionLocaleDir,
  type Locale,
  SUPPORTED_LOCALES,
} from "../../../packages/i18n/src/locales";
import {
  type Arguments,
  loadNativeCatalogs,
  parseNativeMessage,
  position,
  type Segment,
} from "../../../packages/i18n/src/native";

const APPLE = resolve(import.meta.dir, "..");
const MESSAGES_DIR = resolve(
  import.meta.dir,
  "../../../packages/i18n/messages"
);

/** `apple.infoPlist.<Key>` localizes an Info.plist key of the app. */
const INFO_PLIST = "apple.infoPlist.";
/** macOS localizes a Services menu item by its English title. */
const SERVICES_MENU = "apple.servicesMenu.";
/** The Safari extension's `_locales`, which the browser reads. */
const SAFARI = "apple.safari.";
/**
 * App Intents text. The system reads an intent's title and description from
 * the app's own bundle, so these also go into an `AppIntents` table there
 * (`LocalizedStringResource("apple.intents.…", table: "AppIntents")`).
 */
const APP_INTENTS = "apple.intents.";

const formatted = (segments: Segment[], args: Arguments): string => {
  const hasValues = args.count !== undefined || args.names.length > 0;
  return segments
    .map((segment) => {
      if ("text" in segment) {
        return hasValues ? segment.text.replaceAll("%", "%%") : segment.text;
      }
      const index = position(args, segment);
      return "count" in segment ? `%${index}$lld` : `%${index}$@`;
    })
    .join("");
};

const unit = (value: string) => ({
  stringUnit: { state: "translated", value },
});

const localization = (message: string, args: Arguments) => {
  const parsed = parseNativeMessage(message);
  if (parsed.kind === "plain") {
    return unit(formatted(parsed.segments, args));
  }
  return {
    variations: {
      plural: Object.fromEntries(
        Object.entries(parsed.forms).map(([category, segments]) => [
          category,
          unit(formatted(segments, args)),
        ])
      ),
    },
  };
};

type Entries = Map<string, Record<Locale, string>>;

/** Xcode's own layout (`"key" : value`, sorted keys), so saving in Xcode doesn't reformat it. */
const xcstrings = (entries: Entries, argsOf: (key: string) => Arguments) => {
  const strings = Object.fromEntries(
    [...entries.keys()].sort().map((key) => {
      const byLocale = entries.get(key) as Record<Locale, string>;
      return [
        key,
        {
          extractionState: "manual",
          localizations: Object.fromEntries(
            [...SUPPORTED_LOCALES]
              .sort()
              .map((locale) => [
                locale,
                localization(byLocale[locale], argsOf(key)),
              ])
          ),
        },
      ];
    })
  );
  const json = JSON.stringify(
    { sourceLanguage: "en", strings, version: "1.0" },
    null,
    2
  );
  return `${json.replaceAll(/^(\s*"(?:[^"\\]|\\.)*"):/gm, "$1 :")}\n`;
};

export const renderAppleCatalogs = async (): Promise<Map<string, string>> => {
  const { messages, arguments: args } = await loadNativeCatalogs(
    MESSAGES_DIR,
    "apple"
  );
  const argsOf = (key: string) => args.get(key) as Arguments;
  const pick = (
    filter: (key: string) => boolean,
    rename = (k: string) => k
  ) => {
    const entries: Entries = new Map();
    for (const key of messages.en.keys()) {
      if (filter(key)) {
        entries.set(
          rename(key),
          Object.fromEntries(
            SUPPORTED_LOCALES.map((locale) => [
              locale,
              messages[locale].get(key) ?? messages.en.get(key),
            ])
          ) as Record<Locale, string>
        );
      }
    }
    return entries;
  };
  const special = (key: string) =>
    [INFO_PLIST, SERVICES_MENU, SAFARI].some((prefix) =>
      key.startsWith(prefix)
    );

  const files = new Map<string, string>();
  files.set(
    "Packages/TeakKit/Sources/TeakCore/Resources/Localizable.xcstrings",
    xcstrings(
      pick((key) => !special(key)),
      argsOf
    )
  );
  files.set(
    "Teak/Resources/InfoPlist.xcstrings",
    xcstrings(
      pick(
        (key) => key.startsWith(INFO_PLIST),
        (key) => key.slice(INFO_PLIST.length)
      ),
      () => ({ names: [] })
    )
  );
  files.set(
    "Teak/Resources/AppIntents.xcstrings",
    xcstrings(
      pick((key) => key.startsWith(APP_INTENTS)),
      argsOf
    )
  );
  files.set(
    "Teak/Resources/ServicesMenu.xcstrings",
    xcstrings(
      pick(
        (key) => key.startsWith(SERVICES_MENU),
        (key) => messages.en.get(key) as string
      ),
      () => ({ names: [] })
    )
  );
  for (const locale of SUPPORTED_LOCALES) {
    const safari = Object.fromEntries(
      [...messages.en.keys()]
        .filter((key) => key.startsWith(SAFARI))
        .map((key) => {
          if (argsOf(key).names.length > 0 || argsOf(key).count) {
            throw new Error(
              `${key}: Safari extension text can't have placeholders`
            );
          }
          return [
            key.slice(SAFARI.length),
            { message: messages[locale].get(key) ?? messages.en.get(key) },
          ];
        })
    );
    files.set(
      `SafariExtension/Resources/_locales/${extensionLocaleDir(locale)}/messages.json`,
      `${JSON.stringify(safari, null, 2)}\n`
    );
  }
  return files;
};

if (import.meta.main) {
  const files = await renderAppleCatalogs();
  for (const [path, contents] of files) {
    if (process.argv.includes("--write")) {
      await Bun.write(resolve(APPLE, path), contents);
      console.log(`Wrote apps/apple/${path}`);
    } else {
      console.log(`apps/apple/${path}: ${contents.length} bytes`);
    }
  }
}
