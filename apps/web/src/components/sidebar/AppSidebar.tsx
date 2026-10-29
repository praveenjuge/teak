"use client";

import { useTranslations } from "@teak/i18n/react";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import {
  Archive,
  Hash,
  Heart,
  LayoutGrid,
  PanelLeft,
  Settings,
  Trash,
  type VadivamIcon,
} from "vadivam-react";
import { LogoMark } from "@/components/Logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useIsApplePlatform } from "../../hooks/useIsApplePlatform";
import {
  ariaKeyShortcut,
  GO_TO_SETTINGS_KEY,
  GO_TO_VIEW_KEYS,
} from "../../lib/keyboardShortcuts";
import {
  LIBRARY_VIEW_PATHS,
  type LibraryView,
  libraryViewLabel,
} from "../../lib/libraryViews";
import { ShortcutHint } from "../modals/KeyboardShortcutsDialog";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

const TOGGLE_SIDEBAR_KEYS = ["Mod", "B"] as const;

export const LIBRARY_VIEW_ICONS: Record<LibraryView, VadivamIcon> = {
  all: LayoutGrid,
  favorites: Heart,
  archive: Archive,
  trash: Trash,
};

const PRIMARY_VIEWS = ["all", "favorites"] as const;
const SECONDARY_VIEWS = ["archive", "trash"] as const;

export type SidebarLinkComponent = ComponentType<{
  "aria-current"?: "page";
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  href: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}>;

export interface AppSidebarProps {
  activeView: LibraryView | null;
  addActions?: ReactNode;
  foldersSlot?: ReactNode;
  isSettingsActive?: boolean;
  isTagsActive?: boolean;
  LinkComponent: SidebarLinkComponent;
  onNavigate?: () => void;
  settingsHref?: string;
  tagsHref?: string;
}

function ViewTooltip({ view }: { view: LibraryView }) {
  const t = useTranslations("lib.libraryViews");
  const label = libraryViewLabel(view, t);
  return (
    <>
      {label}
      <ShortcutHint
        row={{
          keys: ["G", GO_TO_VIEW_KEYS[view].toUpperCase()],
          label,
          sequence: true,
        }}
      />
    </>
  );
}

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
  const t = useTranslations("sidebar.nav");
  const tViews = useTranslations("lib.libraryViews");
  const { isMobile, setOpenMobile, state, toggleSidebar } = useSidebar();
  const apple = useIsApplePlatform();

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
            <span>{libraryViewLabel(view, tViews)}</span>
          </LinkComponent>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar className="group/sidebar-panel" collapsible="icon">
      <SidebarHeader className="h-13 flex-row items-center gap-0.5 px-2 py-0 group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:justify-start group-data-[collapsible=icon]:pt-2.5 group-data-[collapsible=icon]:pb-0">
        <SidebarMenu className="w-auto">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="h-8 w-auto px-[7px] hover:bg-transparent active:bg-transparent group-data-[collapsible=icon]:h-8! group-data-[collapsible=icon]:px-[7px]! [&>svg]:size-[18px] [&>svg]:opacity-100"
              tooltip="Teak"
            >
              <LinkComponent
                aria-label={t("home")}
                href={LIBRARY_VIEW_PATHS.all}
                onClick={handleNavigate}
              >
                <LogoMark />
              </LinkComponent>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <span className="flex-1 group-data-[collapsible=icon]:hidden" />
        <ShortcutTooltip
          keys={TOGGLE_SIDEBAR_KEYS}
          label={state === "collapsed" ? t("keepOpen") : t("collapse")}
        >
          <button
            aria-expanded={state === "expanded"}
            aria-keyshortcuts={ariaKeyShortcut(TOGGLE_SIDEBAR_KEYS, apple)}
            aria-label={state === "collapsed" ? t("keepOpen") : t("collapse")}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-accent focus-visible:ring-2 max-md:hidden [&>svg]:opacity-60 [&>svg]:transition-opacity hover:[&>svg]:opacity-100"
            data-sidebar="collapse"
            onClick={toggleSidebar}
            type="button"
          >
            <PanelLeft className="size-4" />
          </button>
        </ShortcutTooltip>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {/* A menu item, so it sits in line with the views. */}
            {addActions}
            {PRIMARY_VIEWS.map(viewItem)}
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isTagsActive}
                tooltip={t("tags")}
              >
                <LinkComponent
                  aria-current={isTagsActive ? "page" : undefined}
                  href={tagsHref}
                  onClick={handleNavigate}
                >
                  <Hash />
                  <span>{t("tags")}</span>
                </LinkComponent>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        {foldersSlot}
      </SidebarContent>

      {/* Outside the scrolling content, so a long folder list never hides
          these, in the collapsed rail too. */}
      <SidebarFooter>
        <SidebarMenu>
          {SECONDARY_VIEWS.map(viewItem)}
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isSettingsActive}
              tooltip={{
                className: "flex items-center gap-2",
                children: (
                  <>
                    {t("settings")}
                    <ShortcutHint
                      row={{
                        keys: ["G", GO_TO_SETTINGS_KEY.toUpperCase()],
                        label: t("settings"),
                        sequence: true,
                      }}
                    />
                  </>
                ),
              }}
            >
              <LinkComponent
                aria-current={isSettingsActive ? "page" : undefined}
                aria-label={t("settings")}
                href={settingsHref}
                onClick={handleNavigate}
              >
                <Settings />
                <span>{t("settings")}</span>
              </LinkComponent>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
