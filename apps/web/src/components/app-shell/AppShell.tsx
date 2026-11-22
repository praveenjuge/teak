import { useLocation, useNavigate } from "@tanstack/react-router";
import { TAGS_PATH } from "@teak/convex/shared/webRoutes";
import { type ReactNode, useCallback, useEffect } from "react";
import { preloadCardModal } from "@/components/card-modal/LazyCardModal";
import { AddCardActions, AddCardProvider } from "@/components/forms";
import { LibraryCommandsProvider } from "@/components/providers/LibraryCommandsProvider";
import { LibraryShortcuts } from "@/components/shortcuts";
import { AppSidebar, SidebarFolders } from "@/components/sidebar";
import { SidebarFoldersBoundary } from "@/components/sidebar/SidebarFoldersBoundary";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useSignOut } from "@/hooks/useSignOut";
import { folderIdForPath } from "@/lib/folders";
import { startNewNote } from "@/lib/keyboardShortcuts";
import { whenIdle } from "@/lib/lazyWithPreload";
import {
  type GoToViewOptions,
  type LibraryView,
  libraryViewForPath,
  libraryViewHref,
} from "@/lib/libraryViews";
import { isSettingsPath } from "@/lib/settingsSections";
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
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const view = libraryViewForPath(pathname);
  const folderId = folderIdForPath(pathname);

  // Opening a card is the next thing most visits do.
  useEffect(
    () =>
      whenIdle(() => {
        preloadCardModal().catch(() => undefined);
      }),
    []
  );

  const handleGoToView = useCallback(
    (target: LibraryView, options?: GoToViewOptions) => {
      navigate({ href: libraryViewHref(target, options) });
    },
    [navigate]
  );

  const handleNewNote = useCallback(
    () => startNewNote(handleGoToView),
    [handleGoToView]
  );

  const handleNavigate = useCallback(
    (href: string) => {
      const samePage = href.startsWith(`${pathname}?`);
      navigate({ href, resetScroll: !samePage });
    },
    [pathname, navigate]
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
                  onActiveFolderDeleted={() => {
                    navigate({ href: "/" });
                  }}
                />
              </SidebarFoldersBoundary>
            }
            isSettingsActive={isSettingsPath(pathname)}
            isTagsActive={pathname === TAGS_PATH}
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
