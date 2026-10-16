import { useRef, useState } from "react";

/**
 * Wraps an async action so only one run is in flight: a call made while one
 * runs (a second Enter before the disabled button renders) does nothing.
 * `isPending` is true from the call until the run settles.
 */
export function useSingleFlight<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>
): [run: (...args: Args) => Promise<void>, isPending: boolean] {
  const runningRef = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const run = async (...args: Args) => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setIsPending(true);
    try {
      await action(...args);
    } finally {
      runningRef.current = false;
      setIsPending(false);
    }
  };
  return [run, isPending];
}
