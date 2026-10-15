import { useSyncExternalStore } from "react";
import { isApplePlatform } from "../lib/platform";

const subscribe = () => () => undefined;

/**
 * Whether this is macOS or iOS, for keys rendered on the server too: the
 * server and the first client render say no (so hydration matches), and
 * the client then switches to the real answer.
 */
export function useIsApplePlatform(): boolean {
  return useSyncExternalStore(subscribe, isApplePlatform, () => false);
}
