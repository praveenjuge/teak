"use client";

import { Button } from "@teak/ui/components/ui/button";
import { useCardQueryParamState } from "@teak/ui/hooks";
import { CardsScreen } from "@teak/ui/screens";
import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { useGlobalDragDrop } from "@/hooks/useGlobalDragDrop";

export default function HomePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const cardIdFromUrl = searchParams.get("card");

  const setCardUrlParam = useCallback(
    (cardId: string | null, replace = false) => {
      const params = new URLSearchParams(searchParams.toString());

      if (cardId) {
        params.set("card", cardId);
      } else {
        params.delete("card");
      }

      const nextQuery = params.toString();
      const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;

      if (replace) {
        router.replace(nextUrl);
        return;
      }

      router.push(nextUrl);
    },
    [pathname, router, searchParams]
  );

  const { selectedCardId, openCard, closeCard } = useCardQueryParamState({
    cardIdFromUrl,
    pushCardId: (cardId) => {
      setCardUrlParam(cardId);
    },
    replaceCardId: (cardId) => {
      setCardUrlParam(cardId, true);
    },
  });

  const { getRootProps, getInputProps, isDragActive } = useGlobalDragDrop();

  const settingsButton = (
    <Button asChild size="icon" variant="outline">
      <Link href="/settings">
        <Settings />
      </Link>
    </Button>
  );

  return (
    <CardsScreen
      getInputProps={getInputProps}
      getRootProps={getRootProps}
      isDragActive={isDragActive}
      onCloseCard={closeCard}
      onOpenCard={openCard}
      SettingsButton={settingsButton}
      selectedCardId={selectedCardId}
      toastIdPrefix="web-masonry"
      UpgradeLinkComponent={Link}
      upgradeUrl="/settings"
    />
  );
}
