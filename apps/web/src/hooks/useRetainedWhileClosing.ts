import { useRef } from "react";

export function useRetainedWhileClosing<T>(
  value: T | null | undefined,
  open: boolean
): T | null | undefined {
  const lastValueRef = useRef(value);
  if (value !== null && value !== undefined) {
    lastValueRef.current = value;
  }
  return open ? value : (value ?? lastValueRef.current);
}
