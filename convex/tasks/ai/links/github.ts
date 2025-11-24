import type { LinkCategoryDetail } from "../../../shared";
import type {
  ProviderEnrichmentResult,
  RawSelectorMap,
} from "./common";
import {
  formatCountString,
  getRawText,
  normalizeWhitespace,
} from "./common";

export const enrichGithub = (
  rawMap: RawSelectorMap,
): ProviderEnrichmentResult | null => {
  const stars = formatCountString(getRawText(rawMap, "a[href$='/stargazers']"));
  const forks = formatCountString(
    getRawText(rawMap, "a[href$='/network/members']")
  );
  const watchers = formatCountString(
    getRawText(rawMap, "a[href$='/watchers']")
  );
  const language = getRawText(rawMap, "span[itemprop='programmingLanguage']");
  const updatedRaw = getRawText(rawMap, "relative-time");

  const facts: LinkCategoryDetail[] = [];
  if (stars) facts.push({ label: "Stars", value: stars });
  if (forks) facts.push({ label: "Forks", value: forks });
  if (watchers) facts.push({ label: "Watchers", value: watchers });
  if (language) {
    facts.push({ label: "Language", value: language });
  }
  if (updatedRaw) {
    const formatted = normalizeWhitespace(updatedRaw.replace(/^on\s+/i, ""));
    if (formatted) {
      facts.push({ label: "Updated", value: formatted });
    }
  }

  if (facts.length === 0) {
    return null;
  }

  return {
    facts,
    raw: {
      stars: stars ?? null,
      forks: forks ?? null,
      watchers: watchers ?? null,
      language: language ?? null,
      updated: updatedRaw ?? null,
    },
  };
};
