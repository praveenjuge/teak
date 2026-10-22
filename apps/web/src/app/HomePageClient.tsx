"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";
import { SidebarToggle } from "@/components/sidebar";
import { folderPath } from "@/lib/folders";
import { rememberHomeScroll } from "@/lib/homeScroll";
import {
  FOCUS_COMPOSER_PARAM,
  LIBRARY_VIEW_PATHS,
  type LibraryView,
} from "@/lib/libraryViews";
import {
  parseSearchUrlState,
  type SearchUrlState,
  serializeSearchUrlState,
} from "@/lib/searchUrlState";
import type { SearchUrlChange } from "@/screens";
import { CardsScreenAdapter } from "@/screens";

export function HomePageClient({
  folderId,
  view = "all",
}: {
  folderId?: string;
  view?: LibraryView;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const cardIdFromUrl = searchParams.get("card");
  const addToFolderId = folderId
    ? undefined
    : (searchParams.get("addTo") ?? undefined);
  const searchQueryParam = searchParams.get("q");
  const sortParam = searchParams.get("sort");
  const seedParam = searchParams.get("seed");
  const typeParam = searchParams.get("type");
  const tagParam = searchParams.get("tag");
  const focusComposer = searchParams.get(FOCUS_COMPOSER_PARAM) === "1";
  const searchUrlState = useMemo(() => {
    const params: Record<string, string | null> = {
      q: searchQueryParam,
      seed: seedParam,
      sort: sortParam,
      tag: tagParam,
      type: typeParam,
    };
    return parseSearchUrlState({ get: (name) => params[name] ?? null });
  }, [searchQueryParam, seedParam, sortParam, tagParam, typeParam]);

  // Native history updates the URL synchronously, unlike the router, so an
  // older search can never land after a newer one.
  const handleSearchUrlStateChange = useCallback(
    (state: SearchUrlState, change: SearchUrlChange) => {
      const query = serializeSearchUrlState(state, window.location.search);
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
      if (nextUrl === `${window.location.pathname}${window.location.search}`) {
        return;
      }
      if (change.sortChanged || change.typesChanged || change.tagChanged) {
        window.history.pushState(null, "", nextUrl);
      } else {
        window.history.replaceState(null, "", nextUrl);
      }
    },
    []
  );

  const handleNavigateView = useCallback(
    (nextView: LibraryView) => {
      const params = new URLSearchParams(window.location.search);
      if (params.has("q")) {
        params.delete("q");
        const query = params.toString();
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${query ? `?${query}` : ""}`
        );
      }
      router.push(LIBRARY_VIEW_PATHS[nextView]);
    },
    [router]
  );

  // The URL of the card entry this page pushed over the list, while the
  // card is still open in it.
  const cardEntryUrlRef = useRef<string | null>(null);

  const setCardUrlParam = (cardId: string | null, replace = false) => {
    const params = new URLSearchParams(searchParams.toString());

    if (cardId) {
      params.set("card", cardId);
    } else {
      params.delete("card");
    }

    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    cardEntryUrlRef.current = cardId ? nextUrl : null;

    if (replace) {
      router.replace(nextUrl, { scroll: false });
      return;
    }

    router.push(nextUrl, { scroll: false });
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

  const handleAddCardsToFolder = useCallback(
    (targetFolderId: string) => {
      router.push(`/?addTo=${encodeURIComponent(targetFolderId)}`);
    },
    [router]
  );

  const handleAddToFolderDone = useCallback(
    (targetFolderId: string, added: boolean) => {
      if (added) {
        router.push(folderPath(targetFolderId));
        return;
      }
      const params = new URLSearchParams(window.location.search);
      params.delete("addTo");
      const query = params.toString();
      router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`, {
        scroll: false,
      });
    },
    [router]
  );

  const handleFocusComposerHandled = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete(FOCUS_COMPOSER_PARAM);
    const query = params.toString();
    router.replace(`${window.location.pathname}${query ? `?${query}` : ""}`, {
      scroll: false,
    });
  }, [router]);

  const handleOpenFolder = useCallback(
    (targetFolderId: string) => {
      router.push(folderPath(targetFolderId));
    },
    [router]
  );

  const handleUpgrade = useCallback(() => {
    rememberHomeScroll();
    router.push("/settings");
  }, [router]);

  return (
    <CardsScreenAdapter
      addToFolderId={addToFolderId}
      cardIdFromUrl={cardIdFromUrl}
      focusComposer={focusComposer}
      folderId={folderId}
      headerLeading={<SidebarToggle className="-ml-2" />}
      onAddCardsToFolder={handleAddCardsToFolder}
      onAddToFolderDone={handleAddToFolderDone}
      onFocusComposerHandled={handleFocusComposerHandled}
      onNavigateView={handleNavigateView}
      onOpenFolder={handleOpenFolder}
      onSearchUrlStateChange={handleSearchUrlStateChange}
      onUpgrade={handleUpgrade}
      popCardEntry={popCardEntry}
      pushCardId={(cardId) => {
        setCardUrlParam(cardId);
      }}
      replaceCardId={(cardId) => {
        setCardUrlParam(cardId, true);
      }}
      searchUrlState={searchUrlState}
      toastIdPrefix="web-masonry"
      UpgradeLinkComponent={Link}
      upgradeUrl="/settings"
      view={view}
    />
  );
}
