import {
  SIDEBAR_COOKIE_NAME,
  sidebarOpenFromCookie,
} from "@teak/ui/lib/sidebarState";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "./AppShell";

// Reads the remembered sidebar state on the server, so a collapsed sidebar
// renders collapsed from the first paint.
export async function AppShellFrame({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const defaultOpen = sidebarOpenFromCookie(
    cookieStore.get(SIDEBAR_COOKIE_NAME)?.value
  );
  return <AppShell defaultOpen={defaultOpen}>{children}</AppShell>;
}
