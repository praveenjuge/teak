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

/**
 * The signed-in app frame: the sidebar (views, folders, the New menu,
 * settings) and the content column every app page renders into.
 */
export function AppShell({
  children,
  defaultOpen,
  defaultWidth,
}: {
  children: ReactNode;
  /** The remembered desktop state, read from the cookie on the server. */
  defaultOpen: boolean;
  /** The remembered desktop width in pixels, read from the cookie. */
  defaultWidth: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const view = libraryViewForPath(pathname);
  const folderId = folderIdForPath(pathname);
  // Library views and folders list cards; Settings does not.
  const isCardsPage = view !== null || folderId !== null;

  // `g` then a letter opens a view, like its sidebar link.
  const handleGoToView = useCallback(
    (target: LibraryView) => {
      if (isCardsPage) {
        rememberHomeScroll();
      }
      router.push(LIBRARY_VIEW_PATHS[target]);
    },
    [isCardsPage, router]
  );

  // New > Note or link, like `N`: only Everything has the composer, so
  // elsewhere it opens Everything and the composer takes focus there.
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
