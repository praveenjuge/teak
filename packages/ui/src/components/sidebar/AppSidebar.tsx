"use client";

import {
  CARD_TYPE_LABELS,
  type CardType,
  cardTypes,
} from "@teak/convex/shared/constants";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@teak/ui/components/ui/sidebar";
import { Wordmark } from "@teak/ui/logo";
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
  /** Add actions (upload, record) rendered as menu items above Settings. */
  addActions?: ReactNode;
  /** Phase 5 renders folders here. */
  foldersSlot?: ReactNode;
  isSettingsActive?: boolean;
  LinkComponent: SidebarLinkComponent;
  /** Called before any sidebar link navigates (e.g. to remember scroll). */
  onNavigate?: () => void;
  onToggleType: (type: CardType) => void;
  settingsHref?: string;
  /** Phase 6 renders tags here. */
  tagsSlot?: ReactNode;
}

/**
 * The app's navigation: library views, card types, folders and tags (once
 * they ship), and the add and settings actions. Collapses to icons on
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
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="h-10 hover:bg-transparent active:bg-transparent"
              tooltip="Teak"
            >
              <LinkComponent
                aria-label="Teak home"
                href={LIBRARY_VIEW_PATHS.all}
                onClick={handleNavigate}
              >
                <Wordmark
                  className="h-5! w-auto! shrink-0 text-sidebar-foreground"
                  variant="current"
                />
              </LinkComponent>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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

      <SidebarFooter>
        <SidebarMenu>
          {addActions}
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
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
