import { useEffect, useState } from "react";

/**
 * `value` once it has stayed the same for `delayMs`; at once for a delay of
 * 0. The setter takes a value straight away, ahead of the delay.
 */
export function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return [debounced, setDebounced] as const;
}
