"use client";

import { api } from "@teak/convex";
import { useQuery } from "@teak/ui/convex-query-hooks";
import {
  Component,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { type PublicAuthMode, validateAuthMode } from "@/lib/auth-mode";
import { AuthUnavailable } from "./AuthUnavailable";

const AuthModeContext = createContext<PublicAuthMode | undefined>(undefined);
export const useAuthMode = () => useContext(AuthModeContext);

// React requires a class to catch errors thrown by a reactive subscription.
// biome-ignore lint/style/useReactFunctionComponents: React error boundary API.
class SessionReadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <AuthUnavailable /> : this.props.children;
  }
}

function LiveAuthMode({ children }: { children: ReactNode }) {
  const value = useQuery(api.auth.getAuthMode, {});
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (value !== undefined) {
      setTimedOut(false);
      return;
    }
    const timeout = window.setTimeout(() => setTimedOut(true), 10_000);
    return () => window.clearTimeout(timeout);
  }, [value]);
  if (timedOut && value === undefined) {
    return <AuthUnavailable />;
  }
  const mode = value === undefined ? undefined : validateAuthMode(value);
  return <AuthModeContext value={mode}>{children}</AuthModeContext>;
}

export function AuthModeProvider({ children }: { children: ReactNode }) {
  return (
    <SessionReadBoundary>
      <LiveAuthMode>{children}</LiveAuthMode>
    </SessionReadBoundary>
  );
}
