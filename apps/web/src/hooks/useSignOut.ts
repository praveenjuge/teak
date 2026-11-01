"use client";

import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { useTranslations } from "@teak/i18n/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { signOut } from "@/lib/sign-out-client";

/**
 * Signs out once at a time, and says so when it fails instead of leaving
 * the person signed in without a word.
 */
export function useSignOut(): {
  signOut: () => Promise<void>;
  signingOut: boolean;
} {
  const t = useTranslations("hooks.settings");
  const [signingOut, setSigningOut] = useState(false);
  const busyRef = useRef<boolean>(false);
  const run = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      captureClientException(error, { operation: "auth.sign_out" });
      toast.error(t("signOutFailed"));
    } finally {
      busyRef.current = false;
      setSigningOut(false);
    }
  }, [t]);
  return { signOut: run, signingOut };
}
