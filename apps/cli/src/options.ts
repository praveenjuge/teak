import {
  COLOR_HUE_BUCKETS,
  VISUAL_STYLE_TAXONOMY,
} from "@teak/convex/shared/constants";
import { parseShuffleSeed } from "@teak/convex/shared/search/shuffle";
import { parseTimeSearchQuery } from "@teak/convex/shared/utils/timeSearch";
import { type Command, InvalidArgumentError } from "commander";
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

export const parseSince = (value: string) => {
  const parsed = wholeNumber(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError("since must be a millisecond timestamp");
  }
  return parsed;
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

export const parseDateRange = (value: string, now?: Date) => {
  const parsed = parseTimeSearchQuery(value, { now });
  if (!parsed) {
    throw new InvalidArgumentError(
      'date must be a phrase such as "today", "last week", "march 2026", or "2026-01-01 to 2026-02-01"'
    );
  }
  return parsed.range;
};

export const parseSort = (value: string): CardSort => {
  if (
    !(
      value === "newest" ||
      value === "oldest" ||
      value === "relevance" ||
      value === "shuffle"
    )
  ) {
    throw new InvalidArgumentError(
      "sort must be newest, oldest, relevance or shuffle"
    );
  }
  return value;
};

export const parseMode = (value: string): SearchMode => {
  if (!(value === "hybrid" || value === "keyword" || value === "semantic")) {
    throw new InvalidArgumentError("mode must be hybrid, keyword or semantic");
  }
  return value;
};

export const parseSeed = (value: string): number => {
  const seed = parseShuffleSeed(value.trim());
  if (seed === undefined) {
    throw new InvalidArgumentError(
      "seed must be a whole number from 0 to 2147483647"
    );
  }
  return seed;
};

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.length > 0 ? value : undefined;

export const queryOptions = (options: Record<string, unknown>) => {
  const sort: CardSort | undefined =
    options.sort === "newest" ||
    options.sort === "oldest" ||
    options.sort === "relevance" ||
    options.sort === "shuffle"
      ? options.sort
      : undefined;
  const range = options.date as { end: number; start: number } | undefined;
  return {
    createdAfter:
      typeof options.createdAfter === "string"
        ? Number(options.createdAfter)
        : range?.start,
    createdBefore:
      typeof options.createdBefore === "string"
        ? Number(options.createdBefore)
        : range?.end,
    cursor: typeof options.cursor === "string" ? options.cursor : undefined,
    favorited: options.favorited === true,
    hex: strings(options.hex),
    hue: strings(options.hue),
    include: typeof options.include === "string" ? options.include : "content",
    limit: typeof options.limit === "number" ? options.limit : undefined,
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
      'search text; accepts tag:, #tag, type:, is:fav, is:archived, is:done, is:todo, site:, folder:, like:<id>, mood:"…", price:<100 (or >, <=, >=, =), text:"…" (words read from images and scans) and "phrases"; -word or -tag:x leaves out, a OR b matches either, ( ) groups. Quote a search with a - ("design -tag:old"), or start it after --'
    )
    .option("--similar-to <id>", "only the cards closest in meaning to a card")
    .option(
      "--type <type>",
      "card type; repeat to match any of several",
      repeatable(parseType)
    )
    .option("--tag <tag>", "exact tag")
    .option("--favorited", "favorites only")
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
    .option("--limit <n>", "result limit", parseLimit)
    .option("--cursor <cursor>", "nextCursor from the previous page")
    .option(
      "--sort <sort>",
      "newest, oldest, relevance (best match, with --query) or shuffle",
      parseSort
    )
    .option(
      "--seed <n>",
      "with --sort shuffle: the same seed gives the same order",
      parseSeed
    )
    .option("--created-after <ms>", "created after a millisecond timestamp")
    .option("--created-before <ms>", "created before a millisecond timestamp")
    .option("--include <groups>", "content, metadata, processing")
    .option("--all", "follow every page");
