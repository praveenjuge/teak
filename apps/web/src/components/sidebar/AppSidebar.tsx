"use client";

import { useTranslations } from "@teak/i18n/react";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import { PanelLeft } from "vadivam-react";
import { LogoMark } from "@/components/LogoMark";
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
import { useReturnFocus } from "../../hooks/useReturnFocus";
import { GO_TO, type GoToTarget, goToKeys } from "../../lib/appCommands";
import { ariaKeyShortcut } from "../../lib/keyboardShortcuts";
import { type LibraryView, libraryViewLabel } from "../../lib/libraryViews";
import { ShortcutHint } from "../modals/KeyboardShortcutsDialog";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

const TOGGLE_SIDEBAR_KEYS = ["Mod", "B"] as const;

const PRIMARY_VIEWS = ["all", "favorites"] as const;
const TagsIcon = GO_TO.tags.icon;
const SettingsIcon = GO_TO.settings.icon;
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
}

/** A place's name with its `G` key, as its tooltip shows them. */
const goToTooltip = (target: GoToTarget, label: string) => ({
  className: "flex items-center gap-2",
  children: (
    <>
      {label}
      <ShortcutHint row={{ keys: goToKeys(target), label, sequence: true }} />
    </>
  ),
});

export function AppSidebar({
  activeView,
  addActions,
  foldersSlot,
  isSettingsActive = false,
  isTagsActive = false,
  LinkComponent,
  onNavigate,
}: AppSidebarProps) {
  const t = useTranslations("sidebar.nav");
  const tViews = useTranslations("lib.libraryViews");
  const { isMobile, openMobile, setOpenMobile, state, toggleSidebar } =
    useSidebar();
  // Closing the phone's sheet gives focus back to whatever had it.
  const returnFocus = useReturnFocus(isMobile && openMobile);
  const apple = useIsApplePlatform();

  const handleNavigate = () => {
    onNavigate?.();
    if (isMobile) {
      setOpenMobile(false);
    }
  };

  const viewItem = (view: LibraryView) => {
    const { href, icon: Icon } = GO_TO[view];
    const isActive = activeView === view;
    const label = libraryViewLabel(view, tViews);
    return (
      <SidebarMenuItem key={view}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={goToTooltip(view, label)}
        >
          <LinkComponent
            aria-current={isActive ? "page" : undefined}
            href={href}
            onClick={handleNavigate}
          >
            <Icon />
            <span>{label}</span>
          </LinkComponent>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar
      className="group/sidebar-panel"
      collapsible="icon"
      onMobileCloseAutoFocus={(event) => returnFocus(event)}
    >
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
                href={GO_TO.all.href}
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
                tooltip={goToTooltip("tags", t("tags"))}
              >
                <LinkComponent
                  aria-current={isTagsActive ? "page" : undefined}
                  href={GO_TO.tags.href}
                  onClick={handleNavigate}
                >
                  <TagsIcon />
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
              tooltip={goToTooltip("settings", t("settings"))}
            >
              <LinkComponent
                aria-current={isSettingsActive ? "page" : undefined}
                aria-label={t("settings")}
                href={GO_TO.settings.href}
                onClick={handleNavigate}
              >
                <SettingsIcon />
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
