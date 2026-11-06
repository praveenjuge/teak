import type { LinkCategory, LinkCategoryDetail } from "../linkCategories";
import type { RawSelectorMap } from "./providers/common";

/** The sites the Core Worker asks for a link's details. */
export type RemoteSource =
  | "apple_music"
  | "arxiv"
  | "open_library"
  | "spotify"
  | "wikipedia";

/** What a site told the Core Worker about a link, kept on its card. */
export interface RemoteDetails {
  facts?: LinkCategoryDetail[];
  imageUrl?: string;
  pdfUrl?: string;
  source: RemoteSource;
  summary?: string;
}

export interface RemoteLookupInput {
  category: LinkCategory;
  entities: unknown[];
  provider?: string;
  rawMap: RawSelectorMap;
  sourceUrl: string;
}

export const MAX_LINK_FACTS = 8;

const FACT_LABEL_ALIASES: Record<string, string[]> = {
  Pages: ["Length"],
  Released: ["Release", "Published"],
};

/** Adds facts whose label (or an alias of it) the card doesn't have yet. */
export const fillFacts = (
  target: LinkCategoryDetail[],
  incoming: LinkCategoryDetail[] | undefined
) => {
  const labels = new Set(target.map((fact) => fact.label.toLowerCase()));
  for (const fact of incoming ?? []) {
    if (target.length >= MAX_LINK_FACTS) {
      return;
    }
    const names = [fact.label, ...(FACT_LABEL_ALIASES[fact.label] ?? [])];
    if (names.some((name) => labels.has(name.toLowerCase()))) {
      continue;
    }
    target.push(fact);
    labels.add(fact.label.toLowerCase());
  }
};
