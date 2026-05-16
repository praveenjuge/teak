import { Button } from "@teak/ui/components/ui/button";
import { CardsScreenAdapter } from "@teak/ui/screens";
import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { buildWebUrl } from "@/lib/desktop-config";

interface CardsPageProps {
  onNavigateToSettings: () => void;
}

export function CardsPage({ onNavigateToSettings }: CardsPageProps) {
  const [cardId, setCardId] = useState<string | null>(null);

  const handleOpenExternal = useCallback((url: string) => {
    void window.teakDesktop.shell.openExternal(url);
  }, []);

  const handleUpgrade = useCallback(() => {
    handleOpenExternal(buildWebUrl("/settings"));
  }, [handleOpenExternal]);

  const UpgradeLinkComponent = useCallback(
    ({
      href,
      children,
      className,
    }: {
      href: string;
      children: ReactNode;
      className?: string;
    }) => (
      <a
        className={className}
        href={href}
        onClick={(event) => {
          event.preventDefault();
          handleOpenExternal(href);
        }}
      >
        {children}
      </a>
    ),
    [handleOpenExternal]
  );

  const settingsButton = (
    <Button
      onClick={onNavigateToSettings}
      size="icon"
      type="button"
      variant="outline"
    >
      <Settings className="size-4" />
    </Button>
  );

  return (
    <CardsScreenAdapter
      cardIdFromUrl={cardId}
      contentContainerClassName="mx-auto max-w-7xl px-4 pb-10"
      onUpgrade={handleUpgrade}
      pushCardId={setCardId}
      replaceCardId={setCardId}
      SettingsButton={settingsButton}
      UpgradeLinkComponent={UpgradeLinkComponent}
      upgradeUrl={buildWebUrl("/settings")}
    />
  );
}
