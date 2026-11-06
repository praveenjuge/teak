"use client";

import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback } from "react";
import { AddCardActions, AddCardProvider } from "@/components/forms";
import { LibraryCommandsProvider } from "@/components/providers/LibraryCommandsProvider";
import { LibraryShortcuts } from "@/components/shortcuts";
import { AppSidebar, SidebarFolders } from "@/components/sidebar";
import { SidebarFoldersBoundary } from "@/components/sidebar/SidebarFoldersBoundary";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useSignOut } from "@/hooks/useSignOut";
import { folderIdForPath } from "@/lib/folders";
import { focusNewNoteComposer } from "@/lib/keyboardShortcuts";
import {
  type GoToViewOptions,
  type LibraryView,
  libraryViewForPath,
  libraryViewHref,
} from "@/lib/libraryViews";
import { IntentLink } from "./IntentLink";
import { OfflineNotice } from "./OfflineNotice";
import { MAIN_CONTENT_ID, SkipToContent } from "./SkipToContent";

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

  const handleGoToView = useCallback(
    (target: LibraryView, options?: GoToViewOptions) => {
      router.push(libraryViewHref(target, options));
    },
    [router]
  );

  const handleNewNote = useCallback(() => {
    if (!focusNewNoteComposer()) {
      handleGoToView("all", { focusComposer: true });
    }
  }, [handleGoToView]);

  const handleNavigate = useCallback(
    (href: string) => {
      const samePage = href.startsWith(`${pathname}?`);
      router.push(href, samePage ? { scroll: false } : undefined);
    },
    [pathname, router]
  );

  const { signOut } = useSignOut();
  const handleSignOut = useCallback(() => {
    signOut().catch(() => undefined);
  }, [signOut]);

  return (
    <LibraryCommandsProvider>
      <SidebarProvider defaultOpen={defaultOpen} defaultWidth={defaultWidth}>
        <AddCardProvider onNewNote={handleNewNote}>
          <SkipToContent />
          <OfflineNotice />
          <LibraryShortcuts
            onGoToView={handleGoToView}
            onNavigate={handleNavigate}
            onSignOut={handleSignOut}
            pathname={pathname}
          />
          <AppSidebar
            activeView={view}
            addActions={<AddCardActions />}
            foldersSlot={
              <SidebarFoldersBoundary>
                <SidebarFolders
                  activeFolderId={folderId}
                  LinkComponent={IntentLink}
                  onActiveFolderDeleted={() => {
                    router.push("/");
                  }}
                />
              </SidebarFoldersBoundary>
            }
            isSettingsActive={pathname.startsWith("/settings")}
            isTagsActive={pathname === "/tags"}
            LinkComponent={IntentLink}
          />
          <SidebarInset className="min-w-0 outline-none" id={MAIN_CONTENT_ID}>
            <div className="mx-auto w-full max-w-7xl px-4 pb-10">
              {children}
            </div>
          </SidebarInset>
        </AddCardProvider>
      </SidebarProvider>
    </LibraryCommandsProvider>
  );
}
