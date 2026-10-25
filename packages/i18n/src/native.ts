import {
  type MessageFormatElement,
  parse,
  TYPE,
} from "@formatjs/icu-messageformat-parser";
import { flattenCatalog } from "./catalog";
import { type Locale, SUPPORTED_LOCALES } from "./locales";

/**
 * The Apple and Android apps read text from catalogs generated out of
 * `packages/i18n`: the native catalogs (`messages/native/<locale>.json`, with
 * the `native`, `apple` and `android` namespaces) plus the web keys below,
 * which mean the same on every client.
 */
export const SHARED_WEB_NAMESPACES = [
  "common",
  "errors",
  "cards.types",
  "search.colorHues",
  "search.visualStyles",
  "settings.language",
] as const;

/** Plural categories the platforms support. ICU `=0` style options aren't. */
const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"];

export type Segment = { text: string } | { arg: string } | { count: true };

/** A message as the apps need it: one form, or one per plural category. */
export type NativeMessage =
  | { kind: "plain"; segments: Segment[] }
  | { kind: "plural"; forms: Record<string, Segment[]> };

/**
 * How a message's values are passed in code, fixed by the English message:
 * the plural count first (when there is one), then each other placeholder in
 * the order English first uses it. Translations reorder them by position.
 */
export interface Arguments {
  count?: string;
  names: string[];
}

const unsupported = (what: string) =>
  new Error(
    `${what} isn't supported in native text: use plain {placeholders} and at most one plural`
  );

interface Walk {
  after: MessageFormatElement[];
  before: MessageFormatElement[];
  plural?: { arg: string; forms: Record<string, MessageFormatElement[]> };
}

const splitAtPlural = (elements: MessageFormatElement[]): Walk => {
  const walk: Walk = { before: [], after: [] };
  for (const element of elements) {
    if (element.type === TYPE.plural) {
      if (walk.plural) {
        throw unsupported("A second plural");
      }
      if (element.pluralType === "ordinal" || element.offset) {
        throw unsupported("An ordinal or offset plural");
      }
      const forms: Record<string, MessageFormatElement[]> = {};
      for (const [category, option] of Object.entries(element.options)) {
        if (!PLURAL_CATEGORIES.includes(category)) {
          throw unsupported(`The plural option "${category}"`);
        }
        forms[category] = option.value;
      }
      walk.plural = { arg: element.value, forms };
    } else if (walk.plural) {
      walk.after.push(element);
    } else {
      walk.before.push(element);
    }
  }
  return walk;
};

const segmentsOf = (
  elements: MessageFormatElement[],
  count: string | undefined
): Segment[] =>
  elements.map((element): Segment => {
    switch (element.type) {
      case TYPE.literal:
        return { text: element.value };
      case TYPE.pound:
        if (!count) {
          throw unsupported("# outside a plural");
        }
        return { count: true };
      case TYPE.argument:
        return element.value === count
          ? { count: true }
          : { arg: element.value };
      case TYPE.plural:
        throw unsupported("A plural inside a plural");
      case TYPE.select:
        throw unsupported("A select");
      case TYPE.tag:
        throw unsupported("A tag (rich text)");
      default:
        throw unsupported("A number, date or time format");
    }
  });

/** Parses a message, throwing when it uses ICU the apps can't render. */
export const parseNativeMessage = (message: string): NativeMessage => {
  const walk = splitAtPlural(parse(message, { ignoreTag: false }));
  if (!walk.plural) {
    return { kind: "plain", segments: segmentsOf(walk.before, undefined) };
  }
  const { arg, forms } = walk.plural;
  if (!("other" in forms)) {
    throw unsupported("A plural without `other`");
  }
  const before = segmentsOf(walk.before, arg);
  const after = segmentsOf(walk.after, arg);
  return {
    kind: "plural",
    forms: Object.fromEntries(
      Object.entries(forms).map(([category, elements]) => [
        category,
        [...before, ...segmentsOf(elements, arg), ...after],
      ])
    ),
  };
};

/** The argument order code passes values in, read from the English message. */
export const argumentsOf = (english: string): Arguments => {
  const walk = splitAtPlural(parse(english, { ignoreTag: false }));
  const message = parseNativeMessage(english);
  const forms =
    message.kind === "plain"
      ? [message.segments]
      : Object.values(message.forms);
  const names: string[] = [];
  for (const segments of forms) {
    for (const segment of segments) {
      if ("arg" in segment && !names.includes(segment.arg)) {
        names.push(segment.arg);
      }
    }
  }
  return walk.plural ? { count: walk.plural.arg, names } : { names };
};

export interface NativeCatalogs {
  /** Each key's argument order, from English. */
  arguments: Map<string, Arguments>;
  /** Every key the apps can read, by locale, in English key order. */
  messages: Record<Locale, Map<string, string>>;
}

const readJson = async (path: string) =>
  flattenCatalog(await Bun.file(path).json());

/**
 * Loads the keys one platform reads: the shared `native` namespace, its own
 * namespace (`apple` or `android`) and the shared web namespaces.
 */
export const loadNativeCatalogs = async (
  messagesDir: string,
  platform: "apple" | "android"
): Promise<NativeCatalogs> => {
  const include = (key: string) =>
    key.startsWith("native.") ||
    key.startsWith(`${platform}.`) ||
    SHARED_WEB_NAMESPACES.some((namespace) => key.startsWith(`${namespace}.`));
  const messages = {} as Record<Locale, Map<string, string>>;
  for (const locale of SUPPORTED_LOCALES) {
    const web = await readJson(`${messagesDir}/${locale}.json`);
    const native = await readJson(`${messagesDir}/native/${locale}.json`);
    messages[locale] = new Map(
      [...web, ...native].filter(([key]) => include(key))
    );
  }
  const args = new Map(
    [...messages.en].map(([key, message]) => [key, argumentsOf(message)])
  );
  return { messages, arguments: args };
};

/** Where a placeholder sits in the values code passes: 1-based. */
export const position = (args: Arguments, segment: Segment): number => {
  const offset = args.count ? 1 : 0;
  if ("count" in segment) {
    return 1;
  }
  if ("arg" in segment) {
    const index = args.names.indexOf(segment.arg);
    if (index === -1) {
      throw new Error(`Unknown placeholder {${segment.arg}}`);
    }
    return offset + index + 1;
  }
  throw new Error("Text has no position");
};

export interface TranslationCall {
  /** Whether the call passes a `count`. */
  count: boolean;
  key: string;
  line: number;
  /** How many other values it passes. */
  values: number;
}

/** The end of a string literal starting at `start`, past any `\(…)` or `${…}` inside it. */
const skipString = (source: string, start: number): number => {
  let index = start + 1;
  while (index < source.length && source[index] !== '"') {
    if (source[index] === "\\" && source[index + 1] === "(") {
      index = skipGroup(source, index + 1);
    } else if (source[index] === "$" && source[index + 1] === "{") {
      index = skipGroup(source, index + 1);
    } else {
      index += source[index] === "\\" ? 2 : 1;
    }
  }
  return index + 1;
};

const OPEN = "([{";
const CLOSE = ")]}";

/** The index after the bracket that closes the one at `start`. */
const skipGroup = (source: string, start: number): number => {
  let depth = 0;
  let index = start;
  while (index < source.length) {
    const char = source[index] as string;
    if (char === '"') {
      index = skipString(source, index);
      continue;
    }
    if (OPEN.includes(char)) {
      depth += 1;
    } else if (CLOSE.includes(char)) {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return index;
};

/** Splits a call's argument list at its top-level commas. */
const splitArguments = (inner: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let index = 0;
  while (index < inner.length) {
    const char = inner[index] as string;
    if (char === '"') {
      const end = skipString(inner, index);
      current += inner.slice(index, end);
      index = end;
      continue;
    }
    if (OPEN.includes(char)) {
      depth += 1;
    } else if (CLOSE.includes(char)) {
      depth -= 1;
    }
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
    index += 1;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
};

/**
 * Every call in Swift or Kotlin source that reads a catalog key written out
 * in full, such as `tr("native.library.title", count: n, name)`. Keys built
 * at runtime (`"native.done.\(verb)"`) are skipped.
 */
export const findTranslationCalls = (
  source: string,
  callees: string[]
): TranslationCall[] => {
  const calls: TranslationCall[] = [];
  const pattern = new RegExp(
    `(?<![\\w])(?:${callees.map((callee) => callee.replaceAll(".", "\\.")).join("|")})\\(\\s*"`,
    "g"
  );
  for (const match of source.matchAll(pattern)) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    if (/^\s*(\/\/|\*|\/\*)/.test(source.slice(lineStart, match.index))) {
      continue;
    }
    const open = (match.index ?? 0) + match[0].lastIndexOf("(");
    const end = skipGroup(source, open);
    const [first = "", ...rest] = splitArguments(
      source.slice(open + 1, end - 1)
    );
    const key = first.slice(1, -1);
    if (key.includes("\\(") || key.includes("$")) {
      continue;
    }
    const isCount = (part: string) => /^count\s*[:=]/.test(part);
    calls.push({
      key,
      line: source.slice(0, match.index).split("\n").length,
      count: rest.some(isCount),
      values: rest.filter((part) => !isCount(part)).length,
    });
  }
  return calls;
};

/** Problems with a call: an unknown key, or a count or values that don't fit the message. */
export const checkTranslationCall = (
  call: TranslationCall,
  args: Map<string, Arguments>
): string | undefined => {
  const expected = args.get(call.key);
  if (!expected) {
    return `unknown key ${call.key}`;
  }
  if (Boolean(expected.count) !== call.count) {
    return expected.count
      ? `${call.key} has a plural and needs a count`
      : `${call.key} has no plural, so it takes no count`;
  }
  if (expected.names.length !== call.values) {
    return `${call.key} takes ${expected.names.length} value(s) (${expected.names.join(", ")}), not ${call.values}`;
  }
  return undefined;
};
