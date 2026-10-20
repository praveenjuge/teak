import { useLayoutEffect, useRef, useState } from "react";

type Handler = (...args: never[]) => unknown;

/**
 * Returns handlers whose identities never change but that always call the
 * latest ones passed in, so a memoized child skips renders when only its
 * parent's callbacks were recreated. Call them from events, not during render.
 */
export function useStableHandlers<Handlers extends Record<string, Handler>>(
  handlers: Handlers
): Handlers {
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const [stable] = useState(
    () =>
      Object.fromEntries(
        Object.keys(handlers).map((name) => [
          name,
          (...args: never[]) => latest.current[name]?.(...args),
        ])
      ) as Handlers
  );
  return stable;
}
