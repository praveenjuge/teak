"use client";

import { SidebarInset, SidebarProvider } from "@teak/ui/components/ui/sidebar";
import { NewMenuPlaceholder } from "@teak/ui/forms";
import { folderIdForPath } from "@teak/ui/lib/folders";
import {
  LIBRARY_VIEW_LABELS,
  LIBRARY_VIEW_SEARCH_PLACEHOLDERS,
  libraryViewForPath,
} from "@teak/ui/lib/libraryViews";
import { LibraryPageSkeleton, SettingsShell } from "@teak/ui/screens";
import { SettingsContentSkeleton } from "@teak/ui/settings/SettingsContentSkeleton";
import { AppSidebar, SidebarFoldersSkeleton } from "@teak/ui/sidebar";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SettingsHeader } from "./SettingsBackLink";

/**
 * The app frame while the session and vault load: the real sidebar (in its
 * remembered state) and the page's header over placeholder content, laid out
 * as AppShell lays out the loaded page, so it swaps in without a jump.
 */
export function AppShellSkeleton({
  defaultOpen,
  defaultWidth,
}: {
  defaultOpen: boolean;
  defaultWidth: number;
}) {
  const pathname = usePathname();
  const view = libraryViewForPath(pathname);
  const isSettings = pathname?.startsWith("/settings") ?? false;
  const isTags = pathname === "/tags";
  let title = "";
  if (view) {
    title = LIBRARY_VIEW_LABELS[view];
  } else if (isTags) {
    title = "Tags";
  } else if (folderIdForPath(pathname)) {
    title = "Folder";
  }
  let content = (
    <LibraryPageSkeleton
      searchPlaceholder={
        view ? LIBRARY_VIEW_SEARCH_PLACEHOLDERS[view] : undefined
      }
      title={title}
    />
  );
  if (isSettings) {
    content = (
      <SettingsShell header={<SettingsHeader />}>
        <SettingsContentSkeleton />
      </SettingsShell>
    );
  }
  return (
    <SidebarProvider defaultOpen={defaultOpen} defaultWidth={defaultWidth}>
      <AppSidebar
        activeView={view}
        addActions={<NewMenuPlaceholder />}
        foldersSlot={<SidebarFoldersSkeleton />}
        isSettingsActive={isSettings}
        isTagsActive={isTags}
        LinkComponent={Link}
      />
      <SidebarInset className="min-w-0">
        <div
          className="mx-auto w-full max-w-7xl px-4 pb-10"
          data-slot="page-loading"
        >
          {content}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
