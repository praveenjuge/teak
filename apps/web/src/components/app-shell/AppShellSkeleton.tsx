"use client";

import { useTranslations } from "@teak/i18n/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NewMenuPlaceholder } from "@/components/forms";
import { AppSidebar, SidebarFoldersSkeleton } from "@/components/sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { folderIdForPath } from "@/lib/folders";
import {
  libraryViewForPath,
  libraryViewLabel,
  libraryViewSearchPlaceholder,
} from "@/lib/libraryViews";
import { LibraryPageSkeleton } from "@/screens";
import { SettingsPageSkeleton } from "../settings/SettingsPageSkeleton";

export function AppShellSkeleton({
  defaultOpen,
  defaultWidth,
}: {
  defaultOpen: boolean;
  defaultWidth: number;
}) {
  const t = useTranslations("appShell.skeleton");
  const tViews = useTranslations("lib.libraryViews");
  const pathname = usePathname();
  const view = libraryViewForPath(pathname);
  const isSettings = pathname.startsWith("/settings");
  const isTags = pathname === "/tags";
  let title = "";
  if (view) {
    title = libraryViewLabel(view, tViews);
  } else if (isTags) {
    title = t("tags");
  } else if (folderIdForPath(pathname)) {
    title = t("folder");
  }
  let content = (
    <LibraryPageSkeleton
      searchPlaceholder={
        view ? libraryViewSearchPlaceholder(view, tViews) : undefined
      }
      title={title}
    />
  );
  if (isSettings) {
    content = <SettingsPageSkeleton />;
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
