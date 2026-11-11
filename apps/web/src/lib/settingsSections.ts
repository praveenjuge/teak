import {
  SETTINGS_PATHS,
  type SettingsSectionId,
} from "@teak/convex/shared/webRoutes";
import {
  ArrowDownUp,
  Palette,
  Plug,
  ShieldCheck,
  Sparkles,
  UserRound,
  type VadivamIcon,
} from "vadivam-react";
import { trimTrailingSlashes } from "./routePath";

export type { SettingsSectionId } from "@teak/convex/shared/webRoutes";

export interface SettingsSection {
  href: string;
  icon: VadivamIcon;
  id: SettingsSectionId;
}

const SECTION_ICONS: Record<SettingsSectionId, VadivamIcon> = {
  account: UserRound,
  plan: Sparkles,
  appearance: Palette,
  integrations: Plug,
  security: ShieldCheck,
  data: ArrowDownUp,
};

/** Every Settings page, in the order the nav lists them. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = (
  Object.keys(SETTINGS_PATHS) as SettingsSectionId[]
).map((id) => ({ id, href: SETTINGS_PATHS[id], icon: SECTION_ICONS[id] }));

/** Settings or one of its pages. */
export const isSettingsPath = (pathname: string | null | undefined) =>
  pathname === SETTINGS_PATHS.account ||
  Boolean(pathname?.startsWith(`${SETTINGS_PATHS.account}/`));

/** The Settings pages this deployment shows: Plan only where it sells plans. */
export const visibleSettingsSections = (
  billingEnabled: boolean
): readonly SettingsSection[] =>
  billingEnabled
    ? SETTINGS_SECTIONS
    : SETTINGS_SECTIONS.filter(({ id }) => id !== "plan");

/** Extra English words the command palette matches for each page. */
export const SETTINGS_SECTION_KEYWORDS: Record<
  SettingsSectionId,
  readonly string[]
> = {
  account: ["profile", "email", "sign out"],
  plan: ["billing", "subscription", "upgrade", "pro", "usage"],
  appearance: ["theme", "dark", "light", "language"],
  integrations: ["api keys", "email", "extension", "apps", "mcp"],
  security: ["devices", "sessions", "connected apps"],
  data: ["backup", "download", "bookmarks"],
};

export function settingsSectionForPath(
  pathname: string | null | undefined
): SettingsSection | null {
  if (!pathname) {
    return null;
  }
  const path = trimTrailingSlashes(pathname);
  return SETTINGS_SECTIONS.find((section) => section.href === path) ?? null;
}

export interface SettingsData {
  apiKeys: boolean;
  exportState: boolean;
  sessions: boolean;
}

export const NO_SETTINGS_DATA: SettingsData = {
  apiKeys: false,
  exportState: false,
  sessions: false,
};

export const ALL_SETTINGS_DATA: SettingsData = {
  apiKeys: true,
  exportState: true,
  sessions: true,
};

const SETTINGS_DATA_BY_SECTION: Record<SettingsSectionId, SettingsData> = {
  // The overview sums up keys, devices and the last export.
  account: ALL_SETTINGS_DATA,
  plan: NO_SETTINGS_DATA,
  appearance: NO_SETTINGS_DATA,
  integrations: { ...NO_SETTINGS_DATA, apiKeys: true },
  security: { ...NO_SETTINGS_DATA, sessions: true },
  data: { ...NO_SETTINGS_DATA, exportState: true },
};

/**
 * What a Settings page needs loaded. Signed-in devices come from WorkOS on
 * every load, so pages that don't list them don't ask.
 */
export function settingsDataForPath(
  pathname: string | null | undefined
): SettingsData {
  const section = settingsSectionForPath(pathname);
  return section ? SETTINGS_DATA_BY_SECTION[section.id] : ALL_SETTINGS_DATA;
}
