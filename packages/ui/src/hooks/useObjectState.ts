import { useState } from "react";

export function useObjectState<T extends Record<string, unknown>>(
  createInitialState: () => T
) {
  const [state, setState] = useState<T>(createInitialState);
  const patch = (patchValue: Partial<T>) =>
    setState((prev) => ({ ...prev, ...patchValue }));
  const reset = () => setState(createInitialState());
  const setField = <K extends keyof T>(key: K, value: T[K]) =>
    setState((prev) => ({ ...prev, [key]: value }));
  return { state, patch, reset, setField } as const;
}
