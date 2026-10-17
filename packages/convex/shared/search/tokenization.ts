import {
  type ColorHueBucket,
  normalizeColorHueBucket,
  normalizeVisualStyle,
  type VisualStyle,
} from "../constants";
import { normalizeHexColor } from "../utils/colorUtils";
import {
  SEARCH_TOKEN_SEPARATOR,
  SEARCH_TOKEN_TRIM_CHARACTERS,
} from "./constants";

export type SearchTokenClassification =
  | { kind: "style"; value: VisualStyle }
  | { kind: "hue"; value: ColorHueBucket }
  | { kind: "hex"; value: string }
  | { kind: "keyword"; value: string };

export function normalizeSearchToken(token: string): string {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return "";
  }

  let start = 0;
  let end = trimmedToken.length;

  while (
    start < end &&
    SEARCH_TOKEN_TRIM_CHARACTERS.includes(trimmedToken[start] ?? "")
  ) {
    start += 1;
  }

  while (
    end > start &&
    SEARCH_TOKEN_TRIM_CHARACTERS.includes(trimmedToken[end - 1] ?? "")
  ) {
    end -= 1;
  }

  return trimmedToken.slice(start, end);
}

export function tokenizeSearchInput(query: string): string[] {
  return query
    .split(SEARCH_TOKEN_SEPARATOR)
    .map(normalizeSearchToken)
    .filter(Boolean);
}

const BARE_HEX_COLOR = /^[0-9a-f]{6}$/i;

export function classifySearchToken(
  rawToken: string
): SearchTokenClassification | null {
  const token = normalizeSearchToken(rawToken);
  if (!token) {
    return null;
  }

  const styleFilter = normalizeVisualStyle(token);
  if (styleFilter) {
    return { kind: "style", value: styleFilter };
  }

  const hueFilter = normalizeColorHueBucket(token);
  if (hueFilter) {
    return { kind: "hue", value: hueFilter };
  }

  // Without `#`, only six hex digits make a color: `4411` on a receipt and
  // words such as `bed` or `cafe` stay words.
  const hexFilter =
    token.startsWith("#") || BARE_HEX_COLOR.test(token)
      ? normalizeHexColor(token)
      : null;
  if (hexFilter) {
    return { kind: "hex", value: hexFilter };
  }

  return { kind: "keyword", value: token.toLowerCase() };
}
