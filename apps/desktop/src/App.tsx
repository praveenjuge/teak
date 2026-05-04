import { PageLoadingState } from "@teak/ui/feedback/PageLoadingState";
import { useNetworkStatus } from "@teak/ui/hooks";
import { useConvexAuth } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDesktopMenuEvents } from "@/hooks/useDesktopMenuEvents";
import { logoutDesktopSession } from "@/lib/desktop-auth";
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
      await logoutDesktopSession();
    } catch {
      toast.error("Failed to logout");
    }
  }, []);

  const handleSettingsMenuClick = useCallback(() => {
    if (isAuthenticated) {
      setPage("settings");
    }
  }, [isAuthenticated]);

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

  if (page === "settings") {
    return <SettingsPage onNavigateBack={() => setPage("cards")} />;
  }

  return <CardsPage onNavigateToSettings={() => setPage("settings")} />;
}

export default App;
