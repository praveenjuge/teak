import { cookies } from "next/headers";
import type { ReactNode } from "react";
import {
  SIDEBAR_COOKIE_NAME,
  SIDEBAR_WIDTH_COOKIE_NAME,
  sidebarOpenFromCookie,
  sidebarWidthFromCookie,
} from "@/lib/sidebarState";
import { AppShell } from "./AppShell";

export async function readSidebarCookies() {
  const cookieStore = await cookies();
  return {
    defaultOpen: sidebarOpenFromCookie(
      cookieStore.get(SIDEBAR_COOKIE_NAME)?.value
    ),
    defaultWidth: sidebarWidthFromCookie(
      cookieStore.get(SIDEBAR_WIDTH_COOKIE_NAME)?.value
    ),
  };
}

export async function AppShellFrame({ children }: { children: ReactNode }) {
  const { defaultOpen, defaultWidth } = await readSidebarCookies();
  return (
    <AppShell defaultOpen={defaultOpen} defaultWidth={defaultWidth}>
      {children}
    </AppShell>
  );
}
