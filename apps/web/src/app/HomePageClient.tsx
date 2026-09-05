"use client";

import { Button } from "@teak/ui/components/ui/button";
import { CardsScreenAdapter } from "@teak/ui/screens";
import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function HomePageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const cardIdFromUrl = searchParams.get("card");

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
      onUpgrade={handleUpgrade}
      pushCardId={(cardId) => {
        setCardUrlParam(cardId);
      }}
      replaceCardId={(cardId) => {
        setCardUrlParam(cardId, true);
      }}
      SettingsButton={settingsButton}
      toastIdPrefix="web-masonry"
      UpgradeLinkComponent={Link}
      upgradeUrl="/settings"
    />
  );
}
