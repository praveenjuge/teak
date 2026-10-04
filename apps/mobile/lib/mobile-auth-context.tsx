import { createContext, useContext } from "react";
import type { PublicAuthMode } from "./auth-mode";

interface MobileAuthUser {
  email: string;
  name: string;
  teakUserId: string | null;
}
export interface MobileAuth {
  hasStoredSession: boolean;
  isPending: boolean;
  mode: PublicAuthMode;
  refreshSession: () => Promise<void>;
  signIn: (
    provider?: "authkit" | "GoogleOAuth" | "AppleOAuth",
    screenHint?: "sign-in" | "sign-up"
  ) => Promise<boolean>;
  signOut: () => Promise<void>;
  user: MobileAuthUser | null;
}
export const MobileAuthContext = createContext<MobileAuth | null>(null);
export function useMobileAuth(): MobileAuth {
  const value = useContext(MobileAuthContext);
  if (!value) {
    throw new Error("Mobile authentication provider is missing");
  }
  return value;
}
