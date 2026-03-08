import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@teak/ui/components/ui/button";
import { useCardQueryParamState } from "@teak/ui/hooks";
import { CardsScreen } from "@teak/ui/screens";
import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useGlobalDragDrop } from "@/hooks/useGlobalDragDrop";
import { buildWebUrl } from "@/lib/web-urls";

function DesktopUpgradeLink({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        void openUrl(href);
      }}
    >
      {children}
    </a>
  );
}

export function CardsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const cardIdFromUrl = searchParams.get("card");

  const pushCardId = useCallback(
    (cardId: string) => {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (nextParams.get("card") === cardId) {
            return prev;
          }

          nextParams.set("card", cardId);
          return nextParams;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const replaceCardId = useCallback(
    (cardId: string | null) => {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);

          if (cardId) {
            nextParams.set("card", cardId);
          } else {
            if (!nextParams.has("card")) {
              return prev;
            }
            nextParams.delete("card");
          }

          return nextParams;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const { selectedCardId, openCard, closeCard } = useCardQueryParamState({
    cardIdFromUrl,
    pushCardId,
    replaceCardId,
  });

  const { getRootProps, getInputProps, isDragActive } = useGlobalDragDrop();

  const settingsButton = (
    <Button
      onClick={() => navigate("/settings")}
      size="icon"
      type="button"
      variant="outline"
    >
      <Settings className="size-4" />
    </Button>
  );

  const handleUpgrade = useCallback(() => {
    void openUrl(buildWebUrl("/settings"));
  }, []);

  return (
    <CardsScreen
      contentContainerClassName="mx-auto max-w-7xl px-4 pb-10"
      getInputProps={getInputProps}
      getRootProps={getRootProps}
      isDragActive={isDragActive}
      onCloseCard={closeCard}
      onOpenCard={openCard}
      onUpgrade={handleUpgrade}
      SettingsButton={settingsButton}
      selectedCardId={selectedCardId}
      UpgradeLinkComponent={DesktopUpgradeLink}
      upgradeUrl={buildWebUrl("/settings")}
    />
  );
}
