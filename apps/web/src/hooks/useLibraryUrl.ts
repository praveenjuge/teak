import { CARD_PARAM } from "@teak/convex/shared/webRoutes";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { folderPath } from "@/lib/folders";
import {
  ADD_TO_FOLDER_PARAM,
  addToFolderHref,
  cardHref,
  libraryHref,
  searchWithout,
} from "@/lib/libraryUrl";
import {
  FOCUS_COMPOSER_PARAM,
  LIBRARY_VIEW_PATHS,
  type LibraryView,
} from "@/lib/libraryViews";
import {
  parseSearchUrlState,
  SEARCH_URL_PARAMS,
  type SearchUrlState,
  serializeSearchUrlState,
} from "@/lib/searchUrlState";
import { type SearchUrlChange, searchUrlQuery } from "@/lib/searchUrlSync";
import {
  readSharedText,
  SHARE_FILES_PARAM,
  sharedDraft,
  withoutShareParams,
} from "@/lib/share/sharedContent";
import { useSharedFiles } from "./useSharedFiles";

/**
 * Everything the library reads from its URL and writes back to it: the open
 * card, the search, the folder being added to and a new-note request.
 */
export function useLibraryUrl({ folderId }: { folderId?: string } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const cardIdFromUrl = searchParams.get(CARD_PARAM);
  const addToFolderId = folderId
    ? undefined
    : (searchParams.get(ADD_TO_FOLDER_PARAM) ?? undefined);
  const focusComposer = searchParams.get(FOCUS_COMPOSER_PARAM) === "1";
  const [composerDraft] = useState(() => {
    const shared = readSharedText(searchParams);
    return shared ? sharedDraft(shared) : undefined;
  });
  useSharedFiles(searchParams.get(SHARE_FILES_PARAM));
  // Only the search's own params, so opening a card keeps the same state.
  const searchOnly = new URLSearchParams();
  for (const name of SEARCH_URL_PARAMS) {
    const value = searchParams.get(name);
    if (value !== null) {
      searchOnly.set(name, value);
    }
  }
  const searchKey = searchOnly.toString();
  const searchUrlState = useMemo(
    () => parseSearchUrlState(new URLSearchParams(searchKey)),
    [searchKey]
  );

  // The card this page shows, ahead of the router: closing a card replaces
  // the URL through the router, which can land after a search written below.
  const openCardIdRef = useRef<string | null>(cardIdFromUrl);
  useEffect(() => {
    openCardIdRef.current = cardIdFromUrl;
  }, [cardIdFromUrl]);

  // Native history updates the URL synchronously, unlike the router, so an
  // older search can never land after a newer one.
  const onSearchUrlStateChange = useCallback(
    (state: SearchUrlState, change: SearchUrlChange) => {
      const query = searchUrlQuery(
        state,
        window.location.search,
        openCardIdRef.current
      );
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
      if (nextUrl === `${window.location.pathname}${window.location.search}`) {
        return;
      }
      if (
        change.sortChanged ||
        change.typesChanged ||
        change.tagChanged ||
        change.filtersChanged
      ) {
        window.history.pushState(null, "", nextUrl);
      } else {
        window.history.replaceState(null, "", nextUrl);
      }
    },
    []
  );

  const onNavigateView = useCallback(
    (nextView: LibraryView) => {
      // The search text belongs to the page being left; its filters stay.
      const { pathname: path, search } = window.location;
      const current = parseSearchUrlState(new URLSearchParams(search));
      if (current.q) {
        const query = serializeSearchUrlState({ ...current, q: "" }, search);
        window.history.replaceState(
          null,
          "",
          query ? `${path}?${query}` : path
        );
      }
      router.push(LIBRARY_VIEW_PATHS[nextView]);
    },
    [router]
  );

  // The same search in the whole library, from a view that found nothing.
  // This page's entry keeps its search, so Back returns to it.
  const onSearchEverything = useCallback(() => {
    const current = new URLSearchParams(window.location.search);
    const search = new URLSearchParams();
    for (const name of SEARCH_URL_PARAMS) {
      const value = current.get(name);
      if (value !== null) {
        search.set(name, value);
      }
    }
    router.push(libraryHref(LIBRARY_VIEW_PATHS.all, search));
  }, [router]);

  const cardEntryUrlRef = useRef<string | null>(null);

  const setCardId = (cardId: string | null, replace: boolean) => {
    openCardIdRef.current = cardId;
    const nextUrl = cardHref(cardId, pathname, searchParams.toString());
    cardEntryUrlRef.current = cardId ? nextUrl : null;
    if (replace) {
      router.replace(nextUrl, { scroll: false });
    } else {
      router.push(nextUrl, { scroll: false });
    }
  };

  // Back only while the URL is still the card entry this page pushed: any
  // other write since (a search, a sort) means Back would land elsewhere.
  const popCardEntry = () => {
    const entryUrl = cardEntryUrlRef.current;
    cardEntryUrlRef.current = null;
    if (
      entryUrl === null ||
      entryUrl !== `${window.location.pathname}${window.location.search}`
    ) {
      return false;
    }
    router.back();
    return true;
  };

  const onAddToFolderDone = useCallback(
    (targetFolderId: string, added: boolean) => {
      if (added) {
        router.push(folderPath(targetFolderId));
        return;
      }
      router.replace(
        libraryHref(
          window.location.pathname,
          searchWithout(window.location.search, ADD_TO_FOLDER_PARAM)
        ),
        { scroll: false }
      );
    },
    [router]
  );

  const onFocusComposerHandled = useCallback(() => {
    router.replace(
      libraryHref(
        window.location.pathname,
        searchWithout(
          withoutShareParams(window.location.search),
          FOCUS_COMPOSER_PARAM
        )
      ),
      { scroll: false }
    );
  }, [router]);

  return {
    addToFolderId,
    cardIdFromUrl,
    composerDraft,
    focusComposer,
    onAddCardsToFolder: useCallback(
      (targetFolderId: string) => router.push(addToFolderHref(targetFolderId)),
      [router]
    ),
    onAddToFolderDone,
    onFocusComposerHandled,
    onNavigateView,
    onOpenFolder: useCallback(
      (targetFolderId: string) => router.push(folderPath(targetFolderId)),
      [router]
    ),
    onSearchEverything,
    onSearchUrlStateChange,
    popCardEntry,
    pushCardId: (cardId: string) => setCardId(cardId, false),
    replaceCardId: (cardId: string | null) => setCardId(cardId, true),
    searchUrlState,
  };
}
