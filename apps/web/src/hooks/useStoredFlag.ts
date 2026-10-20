import { useCallback, useState } from "react";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored =
      typeof window === "undefined" ? null : window.localStorage.getItem(key);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

/**
 * A yes or no this browser remembers, like a panel someone collapsed. When
 * storage is blocked it still works, and forgets on reload.
 */
export function useStoredFlag(
  key: string,
  fallback = false
): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const [value, setValue] = useState(() => readFlag(key, fallback));
  const update = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        try {
          window.localStorage.setItem(key, resolved ? "1" : "0");
        } catch {
          // Private windows and blocked storage keep it for this visit only.
        }
        return resolved;
      });
    },
    [key]
  );
  return [value, update];
}
