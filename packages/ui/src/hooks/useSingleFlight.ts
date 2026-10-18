import { useRef, useState } from "react";

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
