"use client";

import { useTranslations } from "@teak/i18n/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
  settingsSectionForPath,
} from "@/lib/settingsSections";
import { cn } from "@/lib/utils";
import { SettingsTile, type SettingsTileTone } from "./SettingsSection";

const SECTION_TONES: Record<SettingsSectionId, SettingsTileTone> = {
  account: "gray",
  plan: "amber",
  appearance: "indigo",
  integrations: "emerald",
  security: "blue",
  data: "cyan",
};

/** A settings page's icon on its own colored tile. */
export function SettingsSectionTile({
  id,
  size = "sm",
}: {
  id: SettingsSectionId;
  size?: "sm" | "md";
}) {
  const section = SETTINGS_SECTIONS.find((item) => item.id === id);
  if (!section) {
    return null;
  }
  return (
    <SettingsTile icon={section.icon} size={size} tone={SECTION_TONES[id]} />
  );
}

// Labels wrap rather than truncate: "Import & export" runs long in German,
// French and the pseudo-locale.
const NAV_LINK =
  "flex min-h-8 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm leading-5 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring";

export function SettingsNav() {
  const t = useTranslations("settings.nav");
  const pathname = usePathname();
  const active = settingsSectionForPath(pathname);
  return (
    <nav aria-label={t("label")}>
      <ul className="space-y-0.5">
        {SETTINGS_SECTIONS.map(({ href, id }) => {
          const current = active?.id === id;
          return (
            <li key={id}>
              <Link
                aria-current={current ? "page" : undefined}
                className={cn(
                  NAV_LINK,
                  current
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
                href={href}
              >
                <SettingsSectionTile id={id} />
                <span className="min-w-0 break-words">{t(id)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
