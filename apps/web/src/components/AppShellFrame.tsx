import {
  SIDEBAR_COOKIE_NAME,
  SIDEBAR_WIDTH_COOKIE_NAME,
  sidebarOpenFromCookie,
  sidebarWidthFromCookie,
} from "@teak/ui/lib/sidebarState";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "./AppShell";

// Reads the remembered sidebar state and width on the server, so the
// sidebar renders collapsed (or at its dragged width) from the first paint.
export async function AppShellFrame({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const defaultOpen = sidebarOpenFromCookie(
    cookieStore.get(SIDEBAR_COOKIE_NAME)?.value
  );
  const defaultWidth = sidebarWidthFromCookie(
    cookieStore.get(SIDEBAR_WIDTH_COOKIE_NAME)?.value
  );
  return (
    <AppShell defaultOpen={defaultOpen} defaultWidth={defaultWidth}>
      {children}
    </AppShell>
  );
}
