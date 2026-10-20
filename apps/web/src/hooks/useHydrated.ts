import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
}
