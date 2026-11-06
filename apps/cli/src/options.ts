import {
  COLOR_HUE_BUCKETS,
  VISUAL_STYLE_TAXONOMY,
} from "@teak/convex/shared/constants";
import {
  MAX_SHUFFLE_SEED,
  PUBLIC_API_CARD_SORTS,
  SEARCH_MODES,
} from "@teak/convex/shared/publicApiContract";
import { parseShuffleSeed } from "@teak/convex/shared/search/shuffle";
import { parsePaletteHex } from "@teak/convex/shared/utils/colorUtils";
import { parseTimeSearchQuery } from "@teak/convex/shared/utils/timeSearch";
import { type Command, InvalidArgumentError, Option } from "commander";
import {
  CARD_TYPES,
  type CardSort,
  isCardType,
  type SearchMode,
} from "teak-sdk";

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

export const parseType = (value: string) => {
  if (!isCardType(value)) {
    throw new InvalidArgumentError(
      `type must be one of: ${CARD_TYPES.join(", ")}`
    );
  }
  return value;
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
  (PUBLIC_API_CARD_SORTS as readonly unknown[]).includes(value);

export const parseSort = (value: string): CardSort => {
  if (!isCardSort(value)) {
    throw new InvalidArgumentError(
      `sort must be ${listed(PUBLIC_API_CARD_SORTS)}`
    );
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
  if (options.json !== true) {
    process.stderr.write("Warning: --cursor is now --next\n");
  }
  return options.cursor;
};

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.length > 0 ? value : undefined;

export const queryOptions = (options: Record<string, unknown>) => {
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
    query: typeof options.query === "string" ? options.query : undefined,
    sort,
    ...(sort === "shuffle" && typeof options.seed === "number"
      ? { shuffleSeed: options.seed }
      : {}),
    style: strings(options.style),
    tag: typeof options.tag === "string" ? options.tag : undefined,
    trashed: options.trashed === true,
    archived: options.archived === true ? ("only" as const) : undefined,
    type: strings(options.type),
  };
};

export const withListOptions = (command: Command) =>
  command
    .option(
      "-q, --query <text>",
      'search text; accepts tag:, #tag, type:, is:fav, is:archived, is:done, is:todo, is:pinned, site:, folder:, like:<id>, mood:"…", price:<100 (or >, <=, >=, =), text:"…" (words read from images and scans) and "phrases"; -word or -tag:x leaves out, a OR b matches either, ( ) groups. Quote a search with a -: -q "design -tag:old"'
    )
    .option("--similar-to <id>", "only the cards closest in meaning to a card")
    .option(
      "--type <type>",
      "card type; repeat to match any of several",
      repeatable(parseType)
    )
    .option("--tag <tag>", "exact tag")
    .option("--favorited", "favorites only")
    .option("--pinned", "pinned cards only, in their pinned order")
    .option("--trashed", "cards in Trash only")
    .option("--archived", "archived cards only")
    .option("--folder <folder>", "cards in this folder, by name or id")
    .option(
      "--style <style>",
      `visual style, repeatable: ${VISUAL_STYLE_TAXONOMY.join(", ")}`,
      repeatable(oneOf("style", VISUAL_STYLE_TAXONOMY))
    )
    .option(
      "--hue <hue>",
      `color family, repeatable: ${COLOR_HUE_BUCKETS.join(", ")}`,
      repeatable(oneOf("hue", COLOR_HUE_BUCKETS))
    )
    .option("--hex <color>", "exact color, repeatable", repeatable(parseHex))
    .option(
      "--date <phrase>",
      'created in a range, such as "last week" or "march 2026"',
      (value) => parseDateRange(value)
    )
    .option(
      "--mode <mode>",
      "how --query finds cards: hybrid (words and meaning, the default), keyword or semantic",
      parseMode
    )
    .option("-n, --limit <NUMBER>", "how many cards to list", parseLimit)
    .option("--next <CURSOR>", "continue a listing from where it stopped")
    .addOption(hiddenCursorOption())
    .option(
      "--sort <sort>",
      "newest, oldest, relevance (best match, with --query) or shuffle",
      parseSort
    )
    .option(
      "--seed <NUMBER>",
      "with --sort shuffle: the same seed gives the same order",
      parseSeed
    )
    .option(
      "--created-after <TIME>",
      "created after a time: 2026-01-01, 3d (3 days ago) or a millisecond timestamp",
      parseTimestamp
    )
    .option(
      "--created-before <TIME>",
      "created before a time: 2026-01-01, 3d (3 days ago) or a millisecond timestamp",
      parseTimestamp
    )
    .option("--include <groups>", "content, metadata, processing")
    .option(
      "-a, --all",
      `follow every page, up to ${MAX_ALL_CARDS.toLocaleString("en-US")} cards`
    );
