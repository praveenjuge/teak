import {
  ArrowDownUp,
  Palette,
  Plug,
  ShieldCheck,
  Sparkles,
  UserRound,
  type VadivamIcon,
} from "vadivam-react";

export type SettingsSectionId =
  | "account"
  | "plan"
  | "appearance"
  | "integrations"
  | "security"
  | "data";

export interface SettingsSection {
  href: string;
  icon: VadivamIcon;
  id: SettingsSectionId;
}

/** Every Settings page, in the order the nav lists them. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "account", href: "/settings", icon: UserRound },
  { id: "plan", href: "/settings/plan", icon: Sparkles },
  { id: "appearance", href: "/settings/appearance", icon: Palette },
  { id: "integrations", href: "/settings/integrations", icon: Plug },
  { id: "security", href: "/settings/security", icon: ShieldCheck },
  { id: "data", href: "/settings/data", icon: ArrowDownUp },
];

export const SETTINGS_PLAN_HREF = "/settings/plan";

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
  const path = pathname.replace(/\/+$/, "");
  return SETTINGS_SECTIONS.find((section) => section.href === path) ?? null;
}

/** The account data a Settings page shows beyond the account itself. */
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

const ALL_SETTINGS_DATA: SettingsData = {
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
