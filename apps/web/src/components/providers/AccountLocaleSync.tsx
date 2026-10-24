"use client";

import { useAccountLocaleSync } from "@/hooks/useAccountLocaleSync";

/** Mounted once the user is signed in; see `useAccountLocaleSync`. */
export function AccountLocaleSync() {
  useAccountLocaleSync();
  return null;
}
