import { type RefObject, useLayoutEffect } from "react";

/**
 * Text typed into a server-rendered field before the page hydrated is in the
 * DOM but not in React's state, and the next render would put the state's
 * value back. This hands it to `onChange` once, as the field hydrates.
 */
export function useAdoptTypedValue(
  ref: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  value: string,
  onChange: (value: string) => void
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: it reads the field once, at hydration
  useLayoutEffect(() => {
    const typed = ref.current?.value;
    if (typed !== undefined && typed !== value) {
      onChange(typed);
    }
  }, []);
}
