"use client";

import { SidebarInset, SidebarProvider } from "@teak/ui/components/ui/sidebar";
import { AddCardActions } from "@teak/ui/forms";
import { folderIdForPath } from "@teak/ui/lib/folders";
import {
  focusNewNoteComposer,
  requestNewNoteComposerFocus,
} from "@teak/ui/lib/keyboardShortcuts";
import type { LibraryView } from "@teak/ui/lib/libraryViews";
import {
  LIBRARY_VIEW_PATHS,
  libraryViewForPath,
} from "@teak/ui/lib/libraryViews";
import { LibraryShortcuts } from "@teak/ui/shortcuts";
import { AppSidebar, SidebarFolders } from "@teak/ui/sidebar";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback } from "react";
import { rememberHomeScroll } from "@/lib/homeScroll";

export function AppShell({
  children,
  defaultOpen,
  defaultWidth,
}: {
  children: ReactNode;
  defaultOpen: boolean;
  defaultWidth: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const view = libraryViewForPath(pathname);
  const folderId = folderIdForPath(pathname);
  const isCardsPage = view !== null || folderId !== null;

  const handleGoToView = useCallback(
    (target: LibraryView) => {
      if (isCardsPage) {
        rememberHomeScroll();
      }
      router.push(LIBRARY_VIEW_PATHS[target]);
    },
    [isCardsPage, router]
  );

  const handleNewNote = useCallback(() => {
    if (!focusNewNoteComposer()) {
      requestNewNoteComposerFocus();
      handleGoToView("all");
    }
  }, [handleGoToView]);

  const handleUpgrade = () => {
    rememberHomeScroll();
    router.push("/settings");
  };

  return (
    <SidebarProvider defaultOpen={defaultOpen} defaultWidth={defaultWidth}>
      <LibraryShortcuts onGoToView={handleGoToView} />
      <AppSidebar
        activeView={view}
        addActions={
          <AddCardActions
            onNewNote={handleNewNote}
            onUpgrade={handleUpgrade}
            upgradeUrl="/settings"
            variant="header"
          />
        }
        foldersSlot={
          <SidebarFolders
            activeFolderId={folderId}
            LinkComponent={Link}
            onActiveFolderDeleted={() => router.push("/")}
            onNavigate={isCardsPage ? rememberHomeScroll : undefined}
          />
        }
        isSettingsActive={pathname?.startsWith("/settings") ?? false}
        isTagsActive={pathname === "/tags"}
        LinkComponent={Link}
        onNavigate={isCardsPage ? rememberHomeScroll : undefined}
      />
      <SidebarInset className="min-w-0">
        <div className="mx-auto w-full max-w-7xl px-4 pb-10">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
