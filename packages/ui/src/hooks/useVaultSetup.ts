import { api } from "@teak/convex";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useEffect, useState } from "react";
import { useNow } from "./useNow";

/**
 * How long a new account shows "Setting up your vault" at most. Its cards
 * normally land within seconds; past this, the library's own empty state
 * takes over so nobody waits on a setup that failed.
 */
export const VAULT_SETUP_MAX_MS = 45_000;

/**
 * Once shown, "Setting up your vault" stays at least this long, even when
 * the cards land sooner, so it reads as a moment rather than a flicker.
 */
export const VAULT_SETUP_MIN_MS = 5000;

export type VaultSetupState = "loading" | "settingUp" | "ready";

/**
 * Where a new account's setup stands, from the server's mark, the time, and
 * when this client first showed the setup (null if it hasn't).
 */
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

/** Whether the signed-in account's getting-started cards are still coming. */
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
