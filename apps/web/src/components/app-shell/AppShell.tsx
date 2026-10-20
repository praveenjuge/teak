"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useRef } from "react";
import { AddCardActions } from "@/components/forms";
import { LibraryShortcuts } from "@/components/shortcuts";
import { AppSidebar, SidebarFolders } from "@/components/sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { folderIdForPath } from "@/lib/folders";
import { rememberHomeScroll } from "@/lib/homeScroll";
import { focusNewNoteComposer } from "@/lib/keyboardShortcuts";
import {
  type GoToViewOptions,
  type LibraryView,
  libraryViewForPath,
  libraryViewHref,
} from "@/lib/libraryViews";
import { signOut } from "@/lib/sign-out-client";
import { IntentLink } from "./IntentLink";

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
    (target: LibraryView, options?: GoToViewOptions) => {
      if (isCardsPage) {
        rememberHomeScroll();
      }
      router.push(libraryViewHref(target, options));
    },
    [isCardsPage, router]
  );

  const handleNewNote = useCallback(() => {
    if (!focusNewNoteComposer()) {
      handleGoToView("all", { focusComposer: true });
    }
  }, [handleGoToView]);

  const handleNavigate = useCallback(
    (href: string) => {
      if (isCardsPage) {
        rememberHomeScroll();
      }
      const samePage = href.startsWith(`${pathname}?`);
      router.push(href, samePage ? { scroll: false } : undefined);
    },
    [isCardsPage, pathname, router]
  );

  const signingOutRef = useRef<boolean>(false);
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
            LinkComponent={IntentLink}
            onActiveFolderDeleted={() => router.push("/")}
            onNavigate={isCardsPage ? rememberHomeScroll : undefined}
          />
        }
        isSettingsActive={pathname.startsWith("/settings")}
        isTagsActive={pathname === "/tags"}
        LinkComponent={IntentLink}
        onNavigate={isCardsPage ? rememberHomeScroll : undefined}
      />
      <SidebarInset className="min-w-0">
        <div className="mx-auto w-full max-w-7xl px-4 pb-10">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
