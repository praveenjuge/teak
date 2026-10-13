"use client";

import {
  CARD_TYPE_LABELS,
  type CardType,
  cardTypes,
} from "@teak/convex/shared/constants";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
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
  File,
  FileText,
  Heart,
  Image,
  LayoutGrid,
  Link as LinkIcon,
  type LucideIcon,
  Palette,
  Quote,
  Settings,
  Trash2,
  Video,
  Volume2,
} from "lucide-react";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import {
  LIBRARY_VIEW_LABELS,
  LIBRARY_VIEW_PATHS,
  LIBRARY_VIEWS,
  type LibraryView,
} from "../../lib/libraryViews";

export const LIBRARY_VIEW_ICONS: Record<LibraryView, LucideIcon> = {
  all: LayoutGrid,
  favorites: Heart,
  archive: Archive,
  trash: Trash2,
};

export const CARD_TYPE_ICONS: Record<CardType, LucideIcon> = {
  text: FileText,
  link: LinkIcon,
  image: Image,
  video: Video,
  audio: Volume2,
  document: File,
  palette: Palette,
  quote: Quote,
};

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
  /** Card types narrowing the library, shown pressed. */
  activeTypes: readonly CardType[];
  /** The open library view, or null outside the library (settings). */
  activeView: LibraryView | null;
  /** Add actions (upload, record), shown as icon buttons beside the logo. */
  addActions?: ReactNode;
  /** The Folders group. */
  foldersSlot?: ReactNode;
  isSettingsActive?: boolean;
  LinkComponent: SidebarLinkComponent;
  /** Called before any sidebar link navigates (e.g. to remember scroll). */
  onNavigate?: () => void;
  onToggleType: (type: CardType) => void;
  settingsHref?: string;
  /** The Tags group. */
  tagsSlot?: ReactNode;
}

/**
 * The app's navigation: the logo with the add actions beside it, library
 * views and Settings, card types, and folders and tags. Collapses to icons on
 * desktop and opens as a drawer on phones.
 */
export function AppSidebar({
  activeTypes,
  activeView,
  addActions,
  foldersSlot,
  isSettingsActive = false,
  LinkComponent,
  onNavigate,
  onToggleType,
  settingsHref = "/settings",
  tagsSlot,
}: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();

  // On phones the drawer closes once the user picks where to go.
  const handleNavigate = () => {
    onNavigate?.();
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {/* The logo on the left and the add actions on the right; stacked
            when the sidebar is collapsed to icons. */}
        <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-start">
          <SidebarMenu className="w-auto">
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className="h-11 hover:bg-transparent active:bg-transparent group-data-[collapsible=icon]:h-11! group-data-[collapsible=icon]:p-0.5!"
                tooltip="Teak"
              >
                <LinkComponent
                  aria-label="Teak home"
                  href={LIBRARY_VIEW_PATHS.all}
                  onClick={handleNavigate}
                >
                  {/* The app icon's mark: left-aligned with the menu icons,
                      centered in the rail when collapsed. */}
                  <LogoMark className="size-7! shrink-0" />
                </LinkComponent>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {addActions}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {LIBRARY_VIEWS.map((view) => {
              const Icon = LIBRARY_VIEW_ICONS[view];
              const isActive = activeView === view;
              return (
                <SidebarMenuItem key={view}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={LIBRARY_VIEW_LABELS[view]}
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
            })}
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

        <SidebarGroup>
          <SidebarGroupLabel>Types</SidebarGroupLabel>
          <SidebarMenu>
            {cardTypes.map((type) => {
              const Icon = CARD_TYPE_ICONS[type];
              const isActive = activeTypes.includes(type);
              return (
                <SidebarMenuItem key={type}>
                  <SidebarMenuButton
                    aria-pressed={isActive}
                    isActive={isActive}
                    onClick={() => {
                      onToggleType(type);
                      handleNavigate();
                    }}
                    tooltip={CARD_TYPE_LABELS[type]}
                  >
                    <Icon />
                    <span>{CARD_TYPE_LABELS[type]}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        {foldersSlot}
        {tagsSlot}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
