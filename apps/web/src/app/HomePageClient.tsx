"use client";

import { Button } from "@teak/ui/components/ui/button";
import { CardsScreenAdapter } from "@teak/ui/screens";
import { Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export function HomePageClient() {
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

  const settingsButton = (
    <Button asChild size="icon" variant="outline">
      <Link href="/settings">
        <Settings />
      </Link>
    </Button>
  );

  const handleUpgrade = useCallback(() => {
    router.push("/settings");
  }, [router]);

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
