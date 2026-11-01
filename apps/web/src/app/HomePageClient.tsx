"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { SidebarToggle } from "@/components/sidebar";
import { useSharedFiles } from "@/hooks/useSharedFiles";
import { folderPath } from "@/lib/folders";
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
import { SETTINGS_PLAN_HREF } from "@/lib/settingsSections";
import {
  readSharedText,
  SHARE_FILES_PARAM,
  sharedDraft,
  withoutShareParams,
} from "@/lib/share/sharedContent";
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
  const styleParam = searchParams.get("style");
  const colorParam = searchParams.get("color");
  const dateParam = searchParams.get("date");
  const focusComposer = searchParams.get(FOCUS_COMPOSER_PARAM) === "1";
  const [composerDraft] = useState(() => {
    const shared = readSharedText(searchParams);
    return shared ? sharedDraft(shared) : undefined;
  });
  useSharedFiles(searchParams.get(SHARE_FILES_PARAM));
  const searchUrlState = useMemo(() => {
    const params: Record<string, string | null> = {
      color: colorParam,
      date: dateParam,
      q: searchQueryParam,
      seed: seedParam,
      sort: sortParam,
      style: styleParam,
      tag: tagParam,
      type: typeParam,
    };
    return parseSearchUrlState({ get: (name) => params[name] ?? null });
  }, [
    colorParam,
    dateParam,
    searchQueryParam,
    seedParam,
    sortParam,
    styleParam,
    tagParam,
    typeParam,
  ]);

  // Native history updates the URL synchronously, unlike the router, so an
  // older search can never land after a newer one.
  const handleSearchUrlStateChange = useCallback(
    (state: SearchUrlState, change: SearchUrlChange) => {
      const query = serializeSearchUrlState(state, window.location.search);
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
    const params = new URLSearchParams(
      withoutShareParams(window.location.search)
    );
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
    router.push(SETTINGS_PLAN_HREF);
  }, [router]);

  return (
    <CardsScreenAdapter
      addToFolderId={addToFolderId}
      cardIdFromUrl={cardIdFromUrl}
      composerDraft={composerDraft}
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
      upgradeUrl={SETTINGS_PLAN_HREF}
      view={view}
    />
  );
}
