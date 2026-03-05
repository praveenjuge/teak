import { PageLoadingState } from "@teak/ui/feedback/PageLoadingState";
import { useNetworkStatus } from "@teak/ui/hooks";
import { useConvexAuth } from "convex/react";
import { useCallback, useEffect, useRef } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { toast } from "sonner";
import { useDesktopMenuEvents } from "@/hooks/useDesktopMenuEvents";
import { useDesktopUpdater } from "@/hooks/useDesktopUpdater";
import { closeAuthWindow } from "@/lib/auth-window";
import { logoutDesktopSession } from "@/lib/desktop-auth";
import { CardsPage } from "./pages/CardsPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";

function AppRoutes() {
  const navigate = useNavigate();
  const { isOnline } = useNetworkStatus();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const wasAuthenticatedRef = useRef(isAuthenticated);
  const { checkForUpdatesInteractively } = useDesktopUpdater();

  const handleLogout = useCallback(async () => {
    try {
      await logoutDesktopSession();
    } catch {
      toast.error("Failed to logout");
    }
  }, []);

  const handleSettingsMenuClick = useCallback(() => {
    if (isAuthenticated) {
      navigate("/settings");
    }
  }, [navigate, isAuthenticated]);

  useDesktopMenuEvents({
    onLogout: () => {
      void handleLogout();
    },
    onSettings: handleSettingsMenuClick,
    onCheckForUpdates: () => {
      void checkForUpdatesInteractively();
    },
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

  if (isLoading) {
    return <PageLoadingState />;
  }

  if (!isAuthenticated) {
    return <LoginPage isOnline={isOnline} />;
  }

  return (
    <Routes>
      <Route element={<CardsPage />} path="/" />
      <Route element={<SettingsPage />} path="/settings" />
      <Route element={<Navigate replace to="/" />} path="*" />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
