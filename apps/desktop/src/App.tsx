import { PageLoadingState } from "@teak/ui/feedback/PageLoadingState";
import { GlobalFileDropProvider, useNetworkStatus } from "@teak/ui/hooks";
import { useConvexAuth } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDesktopMenuEvents } from "@/hooks/useDesktopMenuEvents";
import { logoutNativeSession } from "@/lib/native-auth";
import { buildWebUrl } from "@/lib/desktop-config";
import { CardsPage } from "./pages/CardsPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";

export type DesktopPage = "cards" | "settings";

function App() {
  const [page, setPage] = useState<DesktopPage>("cards");
  const { isOnline } = useNetworkStatus();
  const { isAuthenticated, isLoading } = useConvexAuth();

  const handleLogout = useCallback(async () => {
    try {
      await logoutNativeSession();
    } catch {
      toast.error("Failed to logout");
    }
  }, []);

  const handleSettingsMenuClick = useCallback(() => {
    if (isAuthenticated) {
      setPage("settings");
    }
  }, [isAuthenticated]);

  const handleUpgrade = useCallback(() => {
    void window.teakDesktop.shell.openExternal(buildWebUrl("/settings"));
  }, []);

  useDesktopMenuEvents({
    onLogout: () => {
      void handleLogout();
    },
    onSettings: handleSettingsMenuClick,
  });

  useEffect(() => {
    if (isOnline) {
      return;
    }
    toast.error("You are offline. Login and sync may be unavailable.");
  }, [isOnline]);

  if (isLoading) {
    return <PageLoadingState />;
  }

  if (!isAuthenticated) {
    return <LoginPage isOnline={isOnline} />;
  }

  const authenticatedContent =
    page === "settings" ? (
      <SettingsPage onNavigateBack={() => setPage("cards")} />
    ) : (
      <CardsPage onNavigateToSettings={() => setPage("settings")} />
    );

  return (
    <GlobalFileDropProvider onUpgrade={handleUpgrade}>
      {authenticatedContent}
    </GlobalFileDropProvider>
  );
}

export default App;
