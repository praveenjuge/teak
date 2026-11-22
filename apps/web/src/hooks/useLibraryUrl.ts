import { useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { CARD_PARAM } from "@teak/convex/shared/webRoutes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appSearchParams } from "@/lib/appSearch";
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
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const search = useLocation({ select: (location) => location.search });
  const cardIdFromUrl = search[CARD_PARAM] ?? null;
  const addToFolderId = folderId ? undefined : search[ADD_TO_FOLDER_PARAM];
  const focusComposer = search[FOCUS_COMPOSER_PARAM] === "1";
  const [composerDraft] = useState(() => {
    const shared = readSharedText(appSearchParams(search));
    return shared ? sharedDraft(shared) : undefined;
  });
  useSharedFiles(search[SHARE_FILES_PARAM] ?? null);
  // Only the search's own params, so opening a card keeps the same state.
  const searchOnly = new URLSearchParams();
  for (const name of SEARCH_URL_PARAMS) {
    const value = search[name];
    if (value !== undefined) {
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

  // Router navigations commit in the order they're called, so an older
  // search can never land after a newer one.
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
      // A new sort, type, tag or filter is a step Back returns from; typing
      // only replaces the entry.
      const step =
        change.sortChanged ||
        change.typesChanged ||
        change.tagChanged ||
        change.filtersChanged;
      navigate({ href: nextUrl, replace: !step, resetScroll: false });
      // A click on a link applies the typed search just before it navigates;
      // written in the same tick, the router would fold this entry into the
      // link's push and the page left behind would lose its search.
      router.history.flush();
    },
    [navigate, router]
  );

  const onNavigateView = useCallback(
    (nextView: LibraryView) => {
      // The search text belongs to the page being left; its filters stay.
      const { pathname: path, search } = window.location;
      const current = parseSearchUrlState(new URLSearchParams(search));
      if (current.q) {
        const query = serializeSearchUrlState({ ...current, q: "" }, search);
        navigate({
          href: query ? `${path}?${query}` : path,
          replace: true,
          resetScroll: false,
        });
        // The router's browser history writes changes made in the same tick
        // as one entry, which would drop this replace into the push below.
        router.history.flush();
      }
      navigate({ href: LIBRARY_VIEW_PATHS[nextView] });
    },
    [navigate, router]
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
    navigate({ href: libraryHref(LIBRARY_VIEW_PATHS.all, search) });
  }, [navigate]);

  const cardEntryUrlRef = useRef<string | null>(null);

  const setCardId = (cardId: string | null, replace: boolean) => {
    openCardIdRef.current = cardId;
    const nextUrl = cardHref(
      cardId,
      pathname,
      appSearchParams(search).toString()
    );
    cardEntryUrlRef.current = cardId ? nextUrl : null;
    navigate({ href: nextUrl, replace, resetScroll: false });
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
    router.history.back();
    return true;
  };

  const onAddToFolderDone = useCallback(
    (targetFolderId: string, added: boolean) => {
      if (added) {
        navigate({ href: folderPath(targetFolderId) });
        return;
      }
      navigate({
        href: libraryHref(
          window.location.pathname,
          searchWithout(window.location.search, ADD_TO_FOLDER_PARAM)
        ),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate]
  );

  const onFocusComposerHandled = useCallback(() => {
    navigate({
      href: libraryHref(
        window.location.pathname,
        searchWithout(
          withoutShareParams(window.location.search),
          FOCUS_COMPOSER_PARAM
        )
      ),
      replace: true,
      resetScroll: false,
    });
  }, [navigate]);

  return {
    addToFolderId,
    cardIdFromUrl,
    composerDraft,
    focusComposer,
    onAddCardsToFolder: useCallback(
      (targetFolderId: string) =>
        navigate({ href: addToFolderHref(targetFolderId) }),
      [navigate]
    ),
    onAddToFolderDone,
    onFocusComposerHandled,
    onNavigateView,
    onOpenFolder: useCallback(
      (targetFolderId: string) =>
        navigate({ href: folderPath(targetFolderId) }),
      [navigate]
    ),
    onSearchEverything,
    onSearchUrlStateChange,
    popCardEntry,
    pushCardId: (cardId: string) => setCardId(cardId, false),
    replaceCardId: (cardId: string | null) => setCardId(cardId, true),
    searchUrlState,
  };
}
