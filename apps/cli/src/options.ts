import {
  CARD_LIST_PARAMS,
  type CardListParam,
  MAX_SHUFFLE_SEED,
  SEARCH_QUERY_HELP,
} from "@teak/convex/shared/publicApiContract";
import { formatSearchQualifier } from "@teak/convex/shared/search/qualifiers";
import { parseShuffleSeed } from "@teak/convex/shared/search/shuffle";
import { parsePaletteHex } from "@teak/convex/shared/utils/colorUtils";
import { parseTimeSearchQuery } from "@teak/convex/shared/utils/timeSearch";
import { type Command, InvalidArgumentError, Option } from "commander";
import type { CardListInput, CardSort, CardType, SearchMode } from "teak-sdk";
import { warn } from "./runtime";

const CARD_TYPES = CARD_LIST_PARAMS.type.values;
const CARD_SORTS = CARD_LIST_PARAMS.sort.values;
const SEARCH_MODES = CARD_LIST_PARAMS.mode.values;

const WHOLE_NUMBER_REGEX = /^\d+$/;

const wholeNumber = (value: string) =>
  WHOLE_NUMBER_REGEX.test(value.trim()) ? Number(value) : Number.NaN;

export const parseLimit = (value: string) => {
  const parsed = wholeNumber(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("limit must be a positive number");
  }
  return parsed;
};

const RELATIVE_TIME_REGEX = /^(\d+)\s*(s|m|h|d|w)$/i;
const ISO_DATE_REGEX =
  /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/i;
const UNIT_MS: Record<string, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1000,
  w: 604_800_000,
};

/**
 * A point in time: an ISO date or date-time (a date alone is midnight UTC), a
 * relative age such as 30m, 2h, 3d or 1w (that long ago), or a millisecond
 * timestamp.
 */
export const parseTime = (value: string, now = Date.now()) => {
  const text = value.trim();
  const whole = wholeNumber(text);
  if (Number.isSafeInteger(whole)) {
    return whole;
  }
  const relative = RELATIVE_TIME_REGEX.exec(text);
  if (relative) {
    return (
      now -
      Number(relative[1]) * (UNIT_MS[(relative[2] ?? "").toLowerCase()] ?? 0)
    );
  }
  const parsed = ISO_DATE_REGEX.test(text) ? Date.parse(text) : Number.NaN;
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  throw new InvalidArgumentError(
    "must be a time such as 2026-01-01, 2026-01-01T09:30:00Z, 3d (3 days ago) or a millisecond timestamp"
  );
};

export const parseSince = (value: string) => parseTime(value);

export const parseTimestamp = (value: string) => parseTime(value);

const DURATION_REGEX = /^(\d+)\s*(s|m|h)?$/i;

/** How long to wait: 90s, 10m, 1h, or a number of seconds. */
export const parseDuration = (value: string) => {
  const match = DURATION_REGEX.exec(value.trim());
  const ms = match
    ? Number(match[1]) * (UNIT_MS[(match[2] ?? "s").toLowerCase()] ?? 0)
    : 0;
  if (!(Number.isSafeInteger(ms) && ms > 0)) {
    throw new InvalidArgumentError(
      "timeout must be a duration such as 90s, 10m or 1h"
    );
  }
  return ms;
};

export const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60_000;

export const formatDuration = (ms: number) => {
  if (ms % 3_600_000 === 0) {
    return `${ms / 3_600_000}h`;
  }
  if (ms % 60_000 === 0) {
    return `${ms / 60_000}m`;
  }
  return `${Math.ceil(ms / 1000)}s`;
};

export const parseType = (value: string): CardType => {
  if (!(CARD_TYPES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(
      `type must be one of: ${CARD_TYPES.join(", ")}`
    );
  }
  return value as CardType;
};

export const oneOf =
  (name: string, values: readonly string[]) =>
  (value: string): string => {
    const normalized = value.trim().toLowerCase();
    if (!values.includes(normalized)) {
      throw new InvalidArgumentError(
        `${name} must be one of: ${values.join(", ")}`
      );
    }
    return normalized;
  };

const repeatable =
  <T>(parse: (value: string) => T) =>
  (value: string, previous: T[] = []) => [...previous, parse(value)];

const parseHex = (value: string) => {
  if (!/^#?(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim())) {
    throw new InvalidArgumentError("hex must be a color such as #112233");
  }
  return value.trim();
};

const parsePaletteColor = (value: string) => {
  const hex = parsePaletteHex(value);
  if (!hex) {
    throw new InvalidArgumentError(
      "a palette color must be a hex code such as #FF5500"
    );
  }
  return hex;
};

export const collectPaletteColor = repeatable(parsePaletteColor);

export const parseDateRange = (value: string, now?: Date) => {
  const parsed = parseTimeSearchQuery(value, { now });
  if (!parsed) {
    throw new InvalidArgumentError(
      'date must be a phrase such as "today", "last week", "march 2026", or "2026-01-01 to 2026-02-01"'
    );
  }
  return parsed.range;
};

const listed = (values: readonly string[]) =>
  `${values.slice(0, -1).join(", ")} or ${values.at(-1)}`;

const isCardSort = (value: unknown): value is CardSort =>
  (CARD_SORTS as readonly unknown[]).includes(value);

export const parseSort = (value: string): CardSort => {
  if (!isCardSort(value)) {
    throw new InvalidArgumentError(`sort must be ${listed(CARD_SORTS)}`);
  }
  return value;
};

export const parseMode = (value: string): SearchMode => {
  if (!(SEARCH_MODES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`mode must be ${listed(SEARCH_MODES)}`);
  }
  return value as SearchMode;
};

export const parseSeed = (value: string): number => {
  const seed = parseShuffleSeed(value.trim());
  if (seed === undefined) {
    throw new InvalidArgumentError(
      `seed must be a whole number from 0 to ${MAX_SHUFFLE_SEED}`
    );
  }
  return seed;
};

/** `--all` stops here and says how to continue, so a listing can't run forever. */
export const MAX_ALL_CARDS = 10_000;

/** `--cursor` is the old name of `--next`; it still works, unlisted. */
export const hiddenCursorOption = () =>
  new Option("--cursor <CURSOR>", "old name of --next").hideHelp();

export const cursorOption = (options: Record<string, unknown>) => {
  if (typeof options.next === "string") {
    return options.next;
  }
  if (typeof options.cursor !== "string") {
    return;
  }
  warn("--cursor is now --next", { json: options.json === true });
  return options.cursor;
};

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.length > 0 ? value : undefined;

/**
 * `--tag` once is the API's exact tag filter. Repeated, it matches any of the
 * tags, so the tags join the search as `(tag:a OR tag:b)`, which the API
 * reads the same way everywhere.
 */
const tagFilter = (options: Record<string, unknown>) => {
  const tags = strings(options.tag) ?? [];
  const query = typeof options.query === "string" ? options.query : undefined;
  if (tags.length < 2) {
    return { query, tag: tags[0] };
  }
  const anyTag = `(${tags
    .map((value) => formatSearchQualifier({ key: "tag", value }))
    .join(" OR ")})`;
  // Grouped, so the tags hold for every branch of a search with OR in it:
  // a space binds tighter than OR, and `a OR b (tags)` would tag only b.
  return { query: query ? `(${query}) ${anyTag}` : anyTag, tag: undefined };
};

export const queryOptions = (
  options: Record<string, unknown>
): CardListInput & { include: string } => {
  const sort = isCardSort(options.sort) ? options.sort : undefined;
  const range = options.date as { end: number; start: number } | undefined;
  return {
    createdAfter:
      typeof options.createdAfter === "number"
        ? options.createdAfter
        : range?.start,
    createdBefore:
      typeof options.createdBefore === "number"
        ? options.createdBefore
        : range?.end,
    cursor: cursorOption(options),
    favorited: options.favorited === true,
    hex: strings(options.hex),
    hue: strings(options.hue),
    include: typeof options.include === "string" ? options.include : "content",
    limit: typeof options.limit === "number" ? options.limit : undefined,
    pinned: options.pinned === true,
    mode:
      typeof options.mode === "string"
        ? (options.mode as SearchMode)
        : undefined,
    similarTo:
      typeof options.similarTo === "string" ? options.similarTo : undefined,
    ...tagFilter(options),
    sort,
    ...(sort === "shuffle" && typeof options.seed === "number"
      ? { shuffleSeed: options.seed }
      : {}),
    style: strings(options.style),
    trashed: options.trashed === true,
    archived: options.archived === true ? ("only" as const) : undefined,
    type: strings(options.type),
  };
};

interface ListFlag {
  /** Commander's flags, such as `-n, --limit <NUMBER>`. */
  flags: string;
  help: string;
  parse?: (value: string, previous?: never) => unknown;
}

const LIST_TIME_HELP =
  "a time: 2026-01-01, 3d (3 days ago) or a millisecond timestamp";

/**
 * The flag each card list parameter has, in help order. Every parameter of
 * the public contract needs one, or this doesn't compile.
 */
export const CARD_LIST_FLAGS: Record<CardListParam, ListFlag> = {
  q: {
    flags: "-q, --query <text>",
    help: `${SEARCH_QUERY_HELP} Quote a search with a -: -q "design -tag:old"`,
  },
  similarTo: {
    flags: "--similar-to <id>",
    help: "only the cards closest in meaning to a card",
  },
  type: {
    flags: "--type <type>",
    help: "card type; repeat to match any of several",
    parse: repeatable(parseType),
  },
  tag: {
    flags: "--tag <tag>",
    help: "exact tag; repeat to match any of several",
    parse: repeatable((value: string) => value.trim()),
  },
  favorited: { flags: "--favorited", help: "favorites only" },
  pinned: {
    flags: "--pinned",
    help: "pinned cards only, in their pinned order",
  },
  trashed: { flags: "--trashed", help: "cards in Trash only" },
  archived: { flags: "--archived", help: "archived cards only" },
  folder: {
    flags: "--folder <folder>",
    help: "cards in this folder, by name or id",
  },
  style: {
    flags: "--style <style>",
    help: `visual style, repeatable: ${CARD_LIST_PARAMS.style.values.join(", ")}`,
    parse: repeatable(oneOf("style", CARD_LIST_PARAMS.style.values)),
  },
  hue: {
    flags: "--hue <hue>",
    help: `color family, repeatable: ${CARD_LIST_PARAMS.hue.values.join(", ")}`,
    parse: repeatable(oneOf("hue", CARD_LIST_PARAMS.hue.values)),
  },
  hex: {
    flags: "--hex <color>",
    help: "exact color, repeatable",
    parse: repeatable(parseHex),
  },
  mode: {
    flags: "--mode <mode>",
    help: "how --query finds cards: hybrid (words and meaning, the default), keyword or semantic",
    parse: parseMode,
  },
  limit: {
    flags: "-n, --limit <NUMBER>",
    help: "how many cards to list",
    parse: parseLimit,
  },
  cursor: {
    flags: "--next <CURSOR>",
    help: "continue a listing from where it stopped",
  },
  sort: {
    flags: "--sort <sort>",
    help: "newest, oldest, relevance (best match, with --query) or shuffle",
    parse: parseSort,
  },
  shuffleSeed: {
    flags: "--seed <NUMBER>",
    help: "with --sort shuffle: the same seed gives the same order",
    parse: parseSeed,
  },
  createdAfter: {
    flags: "--created-after <TIME>",
    help: `created after ${LIST_TIME_HELP}`,
    parse: parseTimestamp,
  },
  createdBefore: {
    flags: "--created-before <TIME>",
    help: `created before ${LIST_TIME_HELP}`,
    parse: parseTimestamp,
  },
  include: {
    flags: "--include <groups>",
    help: "content, metadata, processing",
  },
};

/** The long flag a card list parameter has, such as `--next` for `cursor`. */
export const listFlagFor = (param: CardListParam): string =>
  /--[a-z-]+/.exec(CARD_LIST_FLAGS[param].flags)?.[0] ?? "";

export const withListOptions = (command: Command) => {
  for (const { flags, help, parse } of Object.values(CARD_LIST_FLAGS)) {
    const option = new Option(flags, help);
    command.addOption(
      parse
        ? option.argParser(
            parse as (value: string, previous: unknown) => unknown
          )
        : option
    );
  }
  return command
    .option(
      "--date <phrase>",
      'created in a range, such as "last week" or "march 2026"',
      (value) => parseDateRange(value)
    )
    .addOption(hiddenCursorOption())
    .option(
      "-a, --all",
      `follow every page, up to ${MAX_ALL_CARDS.toLocaleString("en-US")} cards`
    );
};

// Commander stops at the first bad value. Each parser here records its
// problem and lets parsing go on, and the root preAction hook reports them all
// before any request.
export const collectInputProblems = (
  command: Command,
  inputProblems: string[]
) => {
  for (const option of command.options) {
    const parse = option.parseArg;
    if (parse) {
      option.parseArg = ((value: string, previous: unknown) => {
        try {
          return parse(value, previous);
        } catch (error) {
          if (!(error instanceof InvalidArgumentError)) {
            throw error;
          }
          inputProblems.push(
            `option '${option.flags}' argument '${value}' is invalid. ${error.message}`
          );
          return previous;
        }
      }) as typeof option.parseArg;
    }
  }
  for (const child of command.commands) {
    collectInputProblems(child, inputProblems);
  }
};
