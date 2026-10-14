"use client";

import { folderPath } from "@teak/ui/lib/folders";
import {
  LIBRARY_VIEW_PATHS,
  type LibraryView,
} from "@teak/ui/lib/libraryViews";
import {
  parseSearchUrlState,
  type SearchUrlState,
  serializeSearchUrlState,
} from "@teak/ui/lib/searchUrlState";
import type { SearchUrlChange } from "@teak/ui/screens";
import { CardsScreenAdapter } from "@teak/ui/screens";
import { SidebarToggle } from "@teak/ui/sidebar";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { rememberHomeScroll } from "@/lib/homeScroll";

export function HomePageClient({
  folderId,
  view = "all",
}: {
  /** A folder view (`/f/:folderId`). */
  folderId?: string;
  view?: LibraryView;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const cardIdFromUrl = searchParams.get("card");
  // `?addTo=<folderId>` on the library: choosing cards for an empty folder.
  const addToFolderId = folderId
    ? undefined
    : (searchParams.get("addTo") ?? undefined);
  const searchQueryParam = searchParams.get("q");
  const sortParam = searchParams.get("sort");
  const typeParam = searchParams.get("type");
  const tagParam = searchParams.get("tag");
  const searchUrlState = useMemo(() => {
    const params: Record<string, string | null> = {
      q: searchQueryParam,
      sort: sortParam,
      tag: tagParam,
      type: typeParam,
    };
    return parseSearchUrlState({ get: (name) => params[name] ?? null });
  }, [searchQueryParam, sortParam, tagParam, typeParam]);

  // The search lives in `?q=`, `?sort=`, `?type=` and `?tag=`. Native
  // history calls update the URL (and useSearchParams) synchronously, so a
  // fast typist's older search can never land after a newer one. Typing
  // replaces the entry; changing the sort, the card types or the tag adds
  // one, so Back returns to the previous order or filters.
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

  // `fav`, `trash` and `archive` typed in search open that view. The command
  // was search text, so drop it from this page's entry first: Back then shows
  // this page without it, and clearing the box has nothing left to write
  // (a write after the push would replace the navigation).
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

  const setCardUrlParam = (cardId: string | null, replace = false) => {
    const params = new URLSearchParams(searchParams.toString());

    if (cardId) {
      params.set("card", cardId);
    } else {
      params.delete("card");
    }

    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;

    // Opening/closing the card modal only toggles a query param; keep the
    // masonry scroll position instead of letting the router jump to the top.
    if (replace) {
      router.replace(nextUrl, { scroll: false });
      return;
    }

    router.push(nextUrl, { scroll: false });
  };

  // "Add cards" in an empty folder picks cards from the whole library.
  const handleAddCardsToFolder = useCallback(
    (targetFolderId: string) => {
      router.push(`/?addTo=${encodeURIComponent(targetFolderId)}`);
    },
    [router]
  );

  // Back to the folder once the cards are in; Cancel just leaves the mode.
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

  const handleOpenFolder = useCallback(
    (targetFolderId: string) => {
      router.push(folderPath(targetFolderId));
    },
    [router]
  );

  // Stable, so the composer (which takes it) isn't remounted on renders.
  const handleUpgrade = useCallback(() => {
    rememberHomeScroll();
    router.push("/settings");
  }, [router]);

  return (
    <CardsScreenAdapter
      addToFolderId={addToFolderId}
      cardIdFromUrl={cardIdFromUrl}
      folderId={folderId}
      headerLeading={<SidebarToggle className="mr-2 -ml-2" />}
      onAddCardsToFolder={handleAddCardsToFolder}
      onAddToFolderDone={handleAddToFolderDone}
      onNavigateView={handleNavigateView}
      onOpenFolder={handleOpenFolder}
      onSearchUrlStateChange={handleSearchUrlStateChange}
      onUpgrade={handleUpgrade}
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
