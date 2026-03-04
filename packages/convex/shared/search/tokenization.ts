import {
  normalizeColorHueBucket,
  normalizeVisualStyle,
  type ColorHueBucket,
  type VisualStyle,
} from "../constants";
import { normalizeHexColor } from "../utils/colorUtils";
import { SEARCH_TOKEN_SEPARATOR, SEARCH_TOKEN_TRIM_PATTERN } from "./constants";

export type SearchTokenClassification =
  | { kind: "style"; value: VisualStyle }
  | { kind: "hue"; value: ColorHueBucket }
  | { kind: "hex"; value: string }
  | { kind: "keyword"; value: string };

export function normalizeSearchToken(token: string): string {
  return token.replace(SEARCH_TOKEN_TRIM_PATTERN, "").trim();
}

export function tokenizeSearchInput(query: string): string[] {
  return query
    .split(SEARCH_TOKEN_SEPARATOR)
    .map(normalizeSearchToken)
    .filter(Boolean);
}

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

  const hexFilter = normalizeHexColor(token);
  if (hexFilter) {
    return { kind: "hex", value: hexFilter };
  }

  return { kind: "keyword", value: token.toLowerCase() };
}
