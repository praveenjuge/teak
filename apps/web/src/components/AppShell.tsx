"use client";

import type { CardType } from "@teak/convex/shared/constants";
import { SidebarInset, SidebarProvider } from "@teak/ui/components/ui/sidebar";
import { AddCardActions } from "@teak/ui/forms";
import {
  LIBRARY_VIEW_PATHS,
  libraryViewForPath,
} from "@teak/ui/lib/libraryViews";
import {
  parseCardTypesParam,
  parseSearchUrlState,
  serializeSearchUrlState,
  toggleSearchUrlType,
} from "@teak/ui/lib/searchUrlState";
import { AppSidebar } from "@teak/ui/sidebar";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { rememberHomeScroll } from "@/lib/homeScroll";

/**
 * The signed-in app frame: the sidebar (views, card types, add actions,
 * settings) and the content column every app page renders into.
 */
export function AppShell({
  children,
  defaultOpen,
}: {
  children: ReactNode;
  /** The remembered desktop state, read from the cookie on the server. */
  defaultOpen: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = libraryViewForPath(pathname);
  const activeTypes = view ? parseCardTypesParam(searchParams.get("type")) : [];

  // A type narrows the open view (Settings goes back to All) and keeps the
  // search; the open card closes because it may not match any more.
  const handleToggleType = (type: CardType) => {
    const params = new URLSearchParams(view ? window.location.search : "");
    params.delete("card");
    const next = toggleSearchUrlType(parseSearchUrlState(params), type);
    const query = serializeSearchUrlState(next, params);
    const path = LIBRARY_VIEW_PATHS[view ?? "all"];
    router.push(query ? `${path}?${query}` : path);
  };

  const handleUpgrade = () => {
    rememberHomeScroll();
    router.push("/settings");
  };

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar
        activeTypes={activeTypes}
        activeView={view}
        addActions={
          <AddCardActions
            onUpgrade={handleUpgrade}
            upgradeUrl="/settings"
            variant="sidebar"
          />
        }
        isSettingsActive={pathname?.startsWith("/settings") ?? false}
        LinkComponent={Link}
        onNavigate={view ? rememberHomeScroll : undefined}
        onToggleType={handleToggleType}
      />
      <SidebarInset>
        <div className="mx-auto w-full max-w-7xl px-4 pb-10">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
