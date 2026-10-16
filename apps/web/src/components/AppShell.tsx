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
import { type ReactNode, useCallback, useRef } from "react";
import { rememberHomeScroll } from "@/lib/homeScroll";
import { signOut } from "@/lib/sign-out-client";

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

  const handleNavigate = useCallback(
    (href: string) => {
      if (isCardsPage) {
        rememberHomeScroll();
      }
      // Opening a card over this page keeps its scroll.
      const samePage = pathname !== null && href.startsWith(`${pathname}?`);
      router.push(href, samePage ? { scroll: false } : undefined);
    },
    [isCardsPage, pathname, router]
  );

  const signingOutRef = useRef(false);
  const handleSignOut = useCallback(() => {
    if (signingOutRef.current) {
      return;
    }
    signingOutRef.current = true;
    signOut().catch(() => {
      signingOutRef.current = false;
    });
  }, []);

  const handleUpgrade = () => {
    rememberHomeScroll();
    router.push("/settings");
  };

  return (
    <SidebarProvider defaultOpen={defaultOpen} defaultWidth={defaultWidth}>
      <LibraryShortcuts
        onGoToView={handleGoToView}
        onNavigate={handleNavigate}
        onSignOut={handleSignOut}
        pathname={pathname}
      />
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
