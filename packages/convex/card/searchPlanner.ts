import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { CardType } from "../schema";
import {
  combineSearchQueries,
  matchesSearchPhrases,
  type ParsedSearchQuery,
} from "../shared/search/qualifiers";
import { normalizeUrlHost } from "../shared/utils/urlHost";
import type { ArchivedFilter } from "./listQuery";
import {
  buildCardSearchText,
  normalizeCardSearchTag,
} from "./searchDocumentHelpers";

/** What a view asks for besides its search text (grid args, API params). */
export interface SearchViewFilters {
  /** Archived cards outside Trash; `is:archived` turns on `"only"`. */
  archived: ArchivedFilter;
  favoritesOnly?: boolean;
  folderId?: Id<"folders">;
  tag?: string;
  trash?: boolean;
  types?: readonly CardType[];
}

/**
 * A search with its qualifiers merged into the view's own filters and
 * folder names resolved. Folders and tags must all match; types and sites
 * match any one. Null when nothing can match (an unknown folder name, or a
 * `type:` outside the view's types).
 */
export interface ResolvedSearch {
  archived: ArchivedFilter;
  favoritesOnly: boolean;
  /** Every folder a card must be in; the first can drive the read. */
  folderIds: Id<"folders">[];
  /** Whether a card read from a driver index still needs `matches`. */
  hasCardFilters: boolean;
  /** Every qualifier and view filter that a card itself can answer. */
  matches: (card: Doc<"cards">) => boolean;
  phrases: string[];
  /** Normalized hosts; a card on any of them matches. */
  sites: string[];
  /** Lowercase tags a card must all carry; the first can drive the read. */
  tags: string[];
  /** The words for the full-text index, without qualifiers. */
  text: string;
  trash: boolean;
  types?: CardType[];
}

const cardHasTag = (card: Doc<"cards">, tag: string) =>
  [...(card.tags ?? []), ...(card.aiTags ?? [])].some(
    (cardTag) => normalizeCardSearchTag(cardTag) === tag
  );

/** The site a card is on, read from its URL so unsynced cards match too. */
export const cardUrlHost = (card: Pick<Doc<"cards">, "url" | "urlHost">) =>
  normalizeUrlHost(card.url) ?? card.urlHost ?? null;

/**
 * The user's folders for `folder:` name keys (trimmed, lowercased names),
 * or null when any name is not one of their manual folders. A folder being
 * deleted no longer answers to its name, and no card is ever in a smart
 * folder, so naming one matches nothing.
 */
export const resolveFolderNames = async (
  ctx: QueryCtx,
  userId: string,
  nameKeys: readonly string[]
): Promise<Id<"folders">[] | null> => {
  const folderIds: Id<"folders">[] = [];
  for (const nameKey of nameKeys) {
    let found: Id<"folders"> | undefined;
    // A deleted folder can share its name with a newer one.
    for await (const folder of ctx.db
      .query("folders")
      .withIndex("by_userId_and_nameKey", (query) =>
        query.eq("userId", userId).eq("nameKey", nameKey)
      )) {
      if (folder.deletingAt === undefined) {
        found = folder.kind === "smart" ? undefined : folder._id;
        break;
      }
    }
    if (!found) {
      return null;
    }
    folderIds.push(found);
  }
  return folderIds;
};

/**
 * A folder view's search. A manual folder keeps its id as the view's
 * filter; a smart folder has no cards of its own, so its stored search
 * joins the typed one (both must match) and the view drops the folder.
 * Null when nothing can match: the folder is missing, another user's or
 * being deleted, or the two searches contradict each other.
 */
export const expandFolderSearch = async (
  ctx: QueryCtx,
  userId: string,
  folderId: Id<"folders"> | undefined,
  searchQuery: string
): Promise<{ folderId?: Id<"folders">; searchQuery: string } | null> => {
  if (!folderId) {
    return { searchQuery };
  }
  const folder = await ctx.db.get("folders", folderId);
  if (!folder || folder.userId !== userId || folder.deletingAt !== undefined) {
    return null;
  }
  if (folder.kind !== "smart") {
    return { folderId, searchQuery };
  }
  const combined = combineSearchQueries(folder.query ?? "", searchQuery);
  return combined === null ? null : { searchQuery: combined };
};

/**
 * Merges a parsed search into a view's filters: `type:` narrows the view's
 * types, `is:fav` turns on favorites, `is:archived` reads Archive (or the
 * archived cards in Trash), and `folder:` names resolve to the user's
 * folders. The server re-reads every search this way and never trusts a
 * client's chips.
 */
export const resolveSearch = async (
  ctx: QueryCtx,
  userId: string,
  parsed: ParsedSearchQuery,
  view: SearchViewFilters
): Promise<ResolvedSearch | null> => {
  const trash = view.trash === true;

  let types = view.types?.length ? [...view.types] : undefined;
  if (parsed.types.length > 0) {
    types = types
      ? types.filter((type) => parsed.types.includes(type))
      : [...parsed.types];
    if (types.length === 0) {
      return null;
    }
  }

  // In Trash, `is:archived` keeps the trashed cards that were archived.
  const archivedInTrash = trash && parsed.archived;
  const archived: ArchivedFilter =
    !trash && parsed.archived ? "only" : view.archived;

  const folderIds: Id<"folders">[] = [];
  if (view.folderId) {
    const folder = await ctx.db.get("folders", view.folderId);
    if (
      !folder ||
      folder.userId !== userId ||
      folder.deletingAt !== undefined
    ) {
      return null;
    }
    folderIds.push(folder._id);
  }
  const named = await resolveFolderNames(ctx, userId, parsed.folders);
  if (!named) {
    return null;
  }
  for (const folderId of named) {
    if (!folderIds.includes(folderId)) {
      folderIds.push(folderId);
    }
  }

  const tags = Array.from(
    new Set([view.tag ?? "", ...parsed.tags].map(normalizeCardSearchTag))
  ).filter(Boolean);
  const { sites, phrases } = parsed;

  const matches = (card: Doc<"cards">) => {
    if (card.userId !== userId) {
      return false;
    }
    if (archivedInTrash && card.isArchived !== true) {
      return false;
    }
    if (types && !types.includes(card.type)) {
      return false;
    }
    if ((view.favoritesOnly || parsed.favorite) && card.isFavorited !== true) {
      return false;
    }
    const cardFolders = card.folderIds ?? [];
    if (!folderIds.every((folderId) => cardFolders.includes(folderId))) {
      return false;
    }
    if (!tags.every((tag) => cardHasTag(card, tag))) {
      return false;
    }
    if (sites.length > 0) {
      const host = cardUrlHost(card);
      if (!(host && sites.includes(host))) {
        return false;
      }
    }
    return matchesSearchPhrases(buildCardSearchText(card), phrases);
  };

  return {
    archived,
    favoritesOnly: Boolean(view.favoritesOnly || parsed.favorite),
    folderIds,
    hasCardFilters:
      archivedInTrash ||
      folderIds.length > 1 ||
      tags.length > 1 ||
      sites.length > 0 ||
      phrases.length > 0,
    matches,
    phrases,
    sites,
    tags,
    text: parsed.text,
    trash,
    types,
  };
};
