import { api } from "@teak/convex";
import { useEffect, useState } from "react";
import { useQuery } from "@/lib/convexQueryHooks";
import { useNow } from "./useNow";

export const VAULT_SETUP_MAX_MS = 45_000;

export const VAULT_SETUP_MIN_MS = 5000;

export type VaultSetupState = "loading" | "settingUp" | "ready";

export const vaultSetupState = (
  setup: { startedAt: number } | null | undefined,
  now: number,
  shownAt: number | null = null
): VaultSetupState => {
  if (setup === undefined) {
    return "loading";
  }
  if (setup !== null && now < setup.startedAt + VAULT_SETUP_MAX_MS) {
    return "settingUp";
  }
  return shownAt !== null && now < shownAt + VAULT_SETUP_MIN_MS
    ? "settingUp"
    : "ready";
};

export function useVaultSetup(): VaultSetupState {
  const setup = useQuery(api.card.vaultSetup.getVaultSetup, {});
  const [shownAt, setShownAt] = useState<number | null>(null);
  const now = useNow({
    until: [
      setup ? setup.startedAt + VAULT_SETUP_MAX_MS : null,
      shownAt === null ? null : shownAt + VAULT_SETUP_MIN_MS,
    ],
  });
  const state = vaultSetupState(setup, now, shownAt);

  useEffect(() => {
    if (state === "settingUp" && shownAt === null) {
      setShownAt(Date.now());
    }
  }, [state, shownAt]);

  return state;
}
