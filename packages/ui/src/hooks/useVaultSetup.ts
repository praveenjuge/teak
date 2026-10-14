import { api } from "@teak/convex";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useEffect, useState } from "react";

/**
 * How long a new account shows "Setting up your vault" at most. Its cards
 * normally land within seconds; past this, the library's own empty state
 * takes over so nobody waits on a setup that failed.
 */
export const VAULT_SETUP_MAX_MS = 45_000;

export type VaultSetupState = "loading" | "settingUp" | "ready";

/** Where a new account's setup stands, from the server's mark and the time. */
export const vaultSetupState = (
  setup: { startedAt: number } | null | undefined,
  now: number
): VaultSetupState => {
  if (setup === undefined) {
    return "loading";
  }
  return setup !== null && now < setup.startedAt + VAULT_SETUP_MAX_MS
    ? "settingUp"
    : "ready";
};

/** Whether the signed-in account's getting-started cards are still coming. */
export function useVaultSetup(): VaultSetupState {
  const setup = useQuery(api.card.vaultSetup.getVaultSetup, {});
  const [now, setNow] = useState(() => Date.now());
  const deadline = setup ? setup.startedAt + VAULT_SETUP_MAX_MS : null;
  useEffect(() => {
    if (deadline === null) {
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => clearTimeout(timer);
  }, [deadline]);
  return vaultSetupState(setup, now);
}
