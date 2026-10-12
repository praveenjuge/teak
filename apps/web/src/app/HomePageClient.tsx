"use client";

import { Button } from "@teak/ui/components/ui/button";
import {
  parseSearchUrlState,
  type SearchUrlState,
  serializeSearchUrlState,
} from "@teak/ui/lib/searchUrlState";
import { CardsScreenAdapter } from "@teak/ui/screens";
import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export function HomePageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const cardIdFromUrl = searchParams.get("card");
  const searchQueryParam = searchParams.get("q");
  const sortParam = searchParams.get("sort");
  const searchUrlState = useMemo(
    () =>
      parseSearchUrlState({
        get: (name) => (name === "q" ? searchQueryParam : sortParam),
      }),
    [searchQueryParam, sortParam]
  );

  // The search lives in `?q=` and `?sort=`. Native history calls update the
  // URL (and useSearchParams) synchronously, so a fast typist's older search
  // can never land after a newer one. Typing replaces the entry; changing
  // the sort adds one, so Back returns to the previous order.
  const handleSearchUrlStateChange = useCallback(
    (state: SearchUrlState, change: { sortChanged: boolean }) => {
      const query = serializeSearchUrlState(state, window.location.search);
      const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
      if (nextUrl === `${window.location.pathname}${window.location.search}`) {
        return;
      }
      if (change.sortChanged) {
        window.history.pushState(null, "", nextUrl);
      } else {
        window.history.replaceState(null, "", nextUrl);
      }
    },
    []
  );

  const rememberHomeScroll = () => {
    const navigation = (
      window as Window & {
        navigation?: {
          currentEntry?: { getState: () => unknown };
          updateCurrentEntry: (options: { state: unknown }) => void;
        };
      }
    ).navigation;
    const state = navigation?.currentEntry?.getState();
    navigation?.updateCurrentEntry({
      state: {
        ...(typeof state === "object" && state ? state : {}),
        __teakHomeScrollY: window.scrollY,
      },
    });
  };

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

  const handleUpgrade = () => {
    rememberHomeScroll();
    router.push("/settings");
  };

  const settingsButton = (
    <Button asChild size="icon" variant="outline">
      <Link
        aria-label="Settings"
        href="/settings"
        onClickCapture={rememberHomeScroll}
      >
        <Settings />
      </Link>
    </Button>
  );

  return (
    <CardsScreenAdapter
      cardIdFromUrl={cardIdFromUrl}
      onSearchUrlStateChange={handleSearchUrlStateChange}
      onUpgrade={handleUpgrade}
      pushCardId={(cardId) => {
        setCardUrlParam(cardId);
      }}
      replaceCardId={(cardId) => {
        setCardUrlParam(cardId, true);
      }}
      SettingsButton={settingsButton}
      searchUrlState={searchUrlState}
      toastIdPrefix="web-masonry"
      UpgradeLinkComponent={Link}
      upgradeUrl="/settings"
    />
  );
}
