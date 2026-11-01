"use client";

import { useTranslations } from "@teak/i18n/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SETTINGS_SECTIONS,
  settingsSectionForPath,
} from "@/lib/settingsSections";
import { cn } from "@/lib/utils";

// Labels wrap rather than truncate: "Import & export" runs long in German,
// French and the pseudo-locale.
const NAV_LINK =
  "flex min-h-8 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm leading-5 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring [&>svg]:size-4 [&>svg]:shrink-0";

export function SettingsNav() {
  const t = useTranslations("settings.nav");
  const pathname = usePathname();
  const active = settingsSectionForPath(pathname);
  return (
    <nav aria-label={t("label")}>
      <ul className="space-y-0.5">
        {SETTINGS_SECTIONS.map(({ href, icon: Icon, id }) => {
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
                <Icon />
                <span className="min-w-0 break-words">{t(id)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
