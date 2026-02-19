import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import { Spinner } from "@teak/ui/components/ui/spinner";
import { useConvexAuth } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Layout } from "@/components/Layout";
import { useDesktopMenuEvents } from "@/hooks/useDesktopMenuEvents";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useSilentUpdater } from "@/hooks/useSilentUpdater";
import { useWindowSizePersistence } from "@/hooks/useWindowSizePersistence";
import { closeAuthWindow } from "@/lib/auth-window";
import { logoutDesktopSession } from "@/lib/desktop-auth";
import { CardsPage } from "./pages/CardsPage";
import { LoginPage } from "./pages/LoginPage";

function App() {
  const { isOnline } = useNetworkStatus();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const wasAuthenticatedRef = useRef(isAuthenticated);

  useSilentUpdater();
  useWindowSizePersistence();

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await logoutDesktopSession();
    } catch {
      toast.error("Failed to logout");
    } finally {
      setIsLoggingOut(false);
    }
  }, []);

  const handlePreferencesMenuClick = useCallback(() => {
    toast.message("Preferences are coming soon.");
  }, []);

  useDesktopMenuEvents({
    onLogout: () => {
      void handleLogout();
    },
    onPreferences: handlePreferencesMenuClick,
  });

  useEffect(() => {
    if (isOnline) {
      return;
    }
    toast.error("You are offline. Login and sync may be unavailable.");
  }, [isOnline]);

  useEffect(() => {
    const becameAuthenticated = !wasAuthenticatedRef.current && isAuthenticated;
    wasAuthenticatedRef.current = isAuthenticated;

    if (!becameAuthenticated) {
      return;
    }

    void closeAuthWindow();
  }, [isAuthenticated]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      if (isCmdOrCtrl && e.key === "w") {
        e.preventDefault();
        void getCurrentWindow().close();
      } else if (isCmdOrCtrl && e.key === "q") {
        e.preventDefault();
        void exit(0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </main>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage isOnline={isOnline} />;
  }

  return (
    <Layout isLoggingOut={isLoggingOut} onLogout={() => void handleLogout()}>
      <CardsPage />
    </Layout>
  );
}

export default App;
