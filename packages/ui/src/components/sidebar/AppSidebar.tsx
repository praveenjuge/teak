"use client";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@teak/ui/components/ui/sidebar";
import { LogoMark } from "@teak/ui/logo";
import {
  Archive,
  Hash,
  Heart,
  LayoutGrid,
  type LucideIcon,
  PanelLeft,
  Settings,
  Trash2,
} from "lucide-react";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import { GO_TO_VIEW_KEYS } from "../../lib/keyboardShortcuts";
import {
  LIBRARY_VIEW_LABELS,
  LIBRARY_VIEW_PATHS,
  type LibraryView,
} from "../../lib/libraryViews";
import { ShortcutHint } from "../modals/KeyboardShortcutsDialog";

export const LIBRARY_VIEW_ICONS: Record<LibraryView, LucideIcon> = {
  all: LayoutGrid,
  favorites: Heart,
  archive: Archive,
  trash: Trash2,
};

/** Views before Tags; Archive and Trash follow it. */
const PRIMARY_VIEWS = ["all", "favorites"] as const;
const SECONDARY_VIEWS = ["archive", "trash"] as const;

/** The app's link (Next.js `Link` on the web), so routes stay client-side. */
export type SidebarLinkComponent = ComponentType<{
  "aria-current"?: "page";
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  href: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}>;

export interface AppSidebarProps {
  /** The open library view, or null outside the library (settings). */
  activeView: LibraryView | null;
  /** The New menu, shown beside the logo. */
  addActions?: ReactNode;
  /** The Folders group. */
  foldersSlot?: ReactNode;
  isSettingsActive?: boolean;
  /** Whether the Tags page is open. */
  isTagsActive?: boolean;
  LinkComponent: SidebarLinkComponent;
  /** Called before any sidebar link navigates (e.g. to remember scroll). */
  onNavigate?: () => void;
  settingsHref?: string;
  tagsHref?: string;
}

function ViewTooltip({ view }: { view: LibraryView }) {
  return (
    <>
      {LIBRARY_VIEW_LABELS[view]}
      <ShortcutHint
        row={{
          keys: ["G", GO_TO_VIEW_KEYS[view].toUpperCase()],
          label: LIBRARY_VIEW_LABELS[view],
          sequence: true,
        }}
      />
    </>
  );
}

/**
 * The app's navigation: the logo with the New menu, one list of places
 * (Everything, Favorites, Tags, Archive, Trash, Settings), then folders.
 * Collapses to icons on desktop (peeking open on hover) and opens as a
 * drawer on phones.
 */
export function AppSidebar({
  activeView,
  addActions,
  foldersSlot,
  isSettingsActive = false,
  isTagsActive = false,
  LinkComponent,
  onNavigate,
  settingsHref = "/settings",
  tagsHref = "/tags",
}: AppSidebarProps) {
  const { isMobile, setOpenMobile, state, toggleSidebar } = useSidebar();

  // On phones the drawer closes once the user picks where to go.
  const handleNavigate = () => {
    onNavigate?.();
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const viewItem = (view: LibraryView) => {
    const Icon = LIBRARY_VIEW_ICONS[view];
    const isActive = activeView === view;
    return (
      <SidebarMenuItem key={view}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={{
            className: "flex items-center gap-2",
            children: <ViewTooltip view={view} />,
          }}
        >
          <LinkComponent
            aria-current={isActive ? "page" : undefined}
            href={LIBRARY_VIEW_PATHS[view]}
            onClick={handleNavigate}
          >
            <Icon />
            <span>{LIBRARY_VIEW_LABELS[view]}</span>
          </LinkComponent>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar className="group/sidebar-panel" collapsible="icon">
      {/* As tall as the page header beside it, so the two share a top line.
          Collapsed, the New button stacks under the logo. */}
      <SidebarHeader className="h-13 flex-row items-center gap-0.5 px-2 py-0 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-start group-data-[collapsible=icon]:pt-2.5 group-data-[collapsible=icon]:pb-2">
        <SidebarMenu className="w-auto">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="h-8 w-auto px-[7px] hover:bg-transparent active:bg-transparent group-data-[collapsible=icon]:h-8! group-data-[collapsible=icon]:px-[7px]! [&>svg]:size-[18px]"
              tooltip="Teak"
            >
              <LinkComponent
                aria-label="Teak home"
                href={LIBRARY_VIEW_PATHS.all}
                onClick={handleNavigate}
              >
                <LogoMark />
              </LinkComponent>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <span className="flex-1 group-data-[collapsible=icon]:hidden" />
        {/* Shown while the pointer is over the sidebar; peeking, it pins
            the sidebar open instead. */}
        <button
          aria-label={
            state === "collapsed" ? "Keep sidebar open" : "Collapse sidebar"
          }
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/55 opacity-0 outline-hidden ring-sidebar-ring transition-[opacity,background-color,color] duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:opacity-100 focus-visible:ring-2 group-hover/sidebar-panel:opacity-100 group-data-[collapsible=icon]:hidden max-md:hidden"
          onClick={toggleSidebar}
          title={
            state === "collapsed" ? "Keep sidebar open" : "Collapse sidebar"
          }
          type="button"
        >
          <PanelLeft className="size-4" />
        </button>
        {addActions}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {PRIMARY_VIEWS.map(viewItem)}
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={isTagsActive} tooltip="Tags">
                <LinkComponent
                  aria-current={isTagsActive ? "page" : undefined}
                  href={tagsHref}
                  onClick={handleNavigate}
                >
                  <Hash />
                  <span>Tags</span>
                </LinkComponent>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {SECONDARY_VIEWS.map(viewItem)}
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isSettingsActive}
                tooltip="Settings"
              >
                <LinkComponent
                  aria-current={isSettingsActive ? "page" : undefined}
                  aria-label="Settings"
                  href={settingsHref}
                  onClick={handleNavigate}
                >
                  <Settings />
                  <span>Settings</span>
                </LinkComponent>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {foldersSlot}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
