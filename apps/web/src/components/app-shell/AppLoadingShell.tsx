"use client";

import { usePathname } from "next/navigation";
import { PanelLeft, Search } from "vadivam-react";
import { CardsGridSkeleton } from "@/components/feedback/CardSkeleton";
import { LogoMark } from "@/components/LogoMark";
import { searchFieldClassName } from "@/components/search/SearchBar";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsPageSkeleton } from "../settings/SettingsPageSkeleton";

const NAV_ROWS = ["new", "all", "favorites", "revisit", "archive", "tags"];

/**
 * The page a document request paints first, before the server has read the
 * session: the app's own frame (sidebar column, header, placeholder cards)
 * with no words in it, so it matches the frame that replaces it in any
 * language and nothing swaps from a spinner to a skeleton.
 */
export function AppLoadingShell() {
  const isSettings = usePathname().startsWith("/settings");
  return (
    <div className="flex min-h-svh w-full" data-slot="app-loading-shell">
      {/* The root layout's head script sets the width and the collapsed state
          from the sidebar cookies, which the static shell can't read. */}
      <div
        aria-hidden="true"
        className="sticky top-0 hidden h-svh w-(--app-loading-sidebar-width,224px) shrink-0 flex-col border-r bg-sidebar px-2 md:flex [[data-sidebar-collapsed]_&]:w-12"
      >
        <div className="flex h-13 items-center px-[7px] [&>svg]:size-[18px] [[data-sidebar-collapsed]_&]:h-auto [[data-sidebar-collapsed]_&]:pt-2.5">
          <LogoMark />
        </div>
        <div className="space-y-1 pt-2 [[data-sidebar-collapsed]_&]:pt-4">
          {NAV_ROWS.map((row) => (
            <div className="flex h-8 items-center gap-2 px-[9px]" key={row}>
              <Skeleton className="size-3.5 shrink-0 rounded" />
              <Skeleton className="h-3 w-20 [[data-sidebar-collapsed]_&]:hidden" />
            </div>
          ))}
        </div>
      </div>
      <main className="relative flex min-w-0 flex-1 flex-col bg-background">
        <div
          className="mx-auto w-full max-w-7xl px-4 pb-10"
          data-slot="page-loading"
        >
          {isSettings ? <SettingsPageSkeleton /> : <LibraryHeaderSkeleton />}
          {isSettings ? null : <CardsGridSkeleton />}
        </div>
      </main>
    </div>
  );
}

function LibraryHeaderSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="-mx-4 mb-3 flex h-13 items-center gap-2 px-4 sm:grid sm:grid-cols-[minmax(6rem,1fr)_minmax(0,36rem)_minmax(auto,1fr)] sm:gap-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="-ml-2 flex size-8 shrink-0 items-center justify-center text-muted-foreground md:hidden">
          <PanelLeft className="size-4" />
        </span>
        <Skeleton className="h-5 w-24" />
      </div>
      <div className="relative min-w-0 flex-1 max-sm:hidden">
        <div className={searchFieldClassName}>
          <Search className="size-4 shrink-0 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
