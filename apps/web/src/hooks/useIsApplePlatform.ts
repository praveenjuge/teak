import { useSyncExternalStore } from "react";
import { isApplePlatform } from "../lib/platform";

const subscribe = () => () => undefined;

/**
 * The server and the first client render say no, so hydration matches;
 * the client then switches to the real answer.
 */
export function useIsApplePlatform(): boolean {
  return useSyncExternalStore(subscribe, isApplePlatform, () => false);
}
