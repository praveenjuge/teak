import { useEffect, useState } from "react";

export function nextDeadline(
  deadlines: readonly (number | null | undefined)[],
  now: number
): number | null {
  let next: number | null = null;
  for (const deadline of deadlines) {
    if (
      typeof deadline === "number" &&
      deadline > now &&
      (next === null || deadline < next)
    ) {
      next = deadline;
    }
  }
  return next;
}

export function useNow({
  every,
  until = [],
}: {
  every?: number;
  until?: readonly (number | null | undefined)[];
}): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (every === undefined) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);

  const next = nextDeadline(until, now);
  useEffect(() => {
    if (next === null) {
      return;
    }
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, next - Date.now()) + 1
    );
    return () => clearTimeout(timer);
  }, [next]);

  return now;
}
