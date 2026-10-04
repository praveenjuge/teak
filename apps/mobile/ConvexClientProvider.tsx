"use client";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@teak/convex";
import { ConvexReactClient } from "convex/react";
import { useNetworkState } from "expo-network";
import { hide as hideSplashScreen } from "expo-splash-screen";
import { type ReactNode, useEffect, useRef, useState } from "react";
import LoadingScreen from "./app/loading";
import OfflineScreen from "./app/offline";
import { type PublicAuthMode, parseAuthMode } from "./lib/auth-mode";
import {
  BetterAuthProvider,
  WorkosAuthProvider,
} from "./lib/MobileAuthProviders";
import { getConvexUrl } from "./lib/public-env";
import { getWorkosSession } from "./lib/workos-native-auth";

// The public mode query runs before authentication; private screens remain
// behind Convex's authenticated state in RootNavigator.
const convex = new ConvexReactClient(getConvexUrl(), {
  unsavedChangesWarning: false,
});
const modeCacheKey = `teak.auth-mode.${encodeURIComponent(getConvexUrl())}`;

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [mode, setMode] = useState<PublicAuthMode>();
  const [error, setError] = useState<Error>();
  const currentMode = useRef<PublicAuthMode | undefined>(undefined);
  const network = useNetworkState();
  const offline =
    network.isInternetReachable === false || network.isConnected === false;
  useEffect(() => {
    let alive = true;
    let revision = 0;
    let liveSeen = false;
    let writes: Promise<void> = Promise.resolve();
    const fail = () => {
      if (alive) {
        // Throwing during render prevents a splash-hiding effect from committing.
        hideSplashScreen();
        setError(new Error("Unable to load sign-in configuration"));
      }
    };
    const accept = async (raw: unknown, live: boolean) => {
      const next = parseAuthMode(raw);
      const update = ++revision;
      const previous = currentMode.current;
      if (
        previous?.primary === "workos" &&
        previous.authKitClientId &&
        (next.primary !== previous.primary ||
          next.authKitClientId !== previous.authKitClientId)
      ) {
        await getWorkosSession(previous.authKitClientId).clear();
      }
      if (!alive || update !== revision) {
        return;
      }
      currentMode.current = next;
      setMode(next);
      setError(undefined);
      if (live) {
        writes = writes
          .catch(() => {})
          .then(() => AsyncStorage.setItem(modeCacheKey, JSON.stringify(next)));
        void writes.catch(() => {}); // A public-config cache outage does not invalidate a live session.
      }
    };
    const watch = convex.watchQuery(api.auth.getAuthMode, {});
    const update = () => {
      try {
        const result = watch.localQueryResult();
        if (result !== undefined) {
          liveSeen = true;
          void accept(result, true).catch(fail);
        }
      } catch {
        fail();
      }
    };
    const unsubscribe = watch.onUpdate(update);
    update();
    void AsyncStorage.getItem(modeCacheKey)
      .then((stored) => {
        // A cache read must never replace configuration already received live.
        if (
          alive &&
          !liveSeen &&
          revision === 0 &&
          stored &&
          stored.length <= 4096
        ) {
          return accept(JSON.parse(stored), false);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    // The navigator hides the splash once mounted; an offline first launch must
    // also show its recovery screen when no cached configuration exists.
    if (!mode && (offline || error)) {
      hideSplashScreen();
    }
  }, [mode, offline, error]);
  useEffect(() => {
    if (mode || offline) {
      return;
    }
    const timeout = setTimeout(() => {
      hideSplashScreen();
      setError(new Error("Unable to connect. Please try again."));
    }, 10_000);
    return () => clearTimeout(timeout);
  }, [mode, offline]);
  if (error) {
    throw error;
  }
  if (!mode) {
    return offline ? <OfflineScreen /> : <LoadingScreen />;
  }
  if (mode.primary === "workos") {
    return (
      <WorkosAuthProvider client={convex} mode={mode}>
        {children}
      </WorkosAuthProvider>
    );
  }
  return (
    <BetterAuthProvider client={convex} mode={mode}>
      {children}
    </BetterAuthProvider>
  );
}
