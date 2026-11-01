"use client";

import { useTranslations } from "@teak/i18n/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect } from "react";
import { ChevronRight } from "vadivam-react";
import { SidebarToggle } from "@/components/sidebar";
import { settingsSectionForPath } from "@/lib/settingsSections";
import { PageHeader, PageTitle } from "@/screens";

export function SettingsHeader() {
  const t = useTranslations("settings");
  const section = settingsSectionForPath(usePathname());
  const subpage = section && section.id !== "account" ? section : null;
  const pageName = subpage ? t(`nav.${subpage.id}`) : null;
  const documentTitle = pageName
    ? t("header.subpageTitle", { page: pageName })
    : t("header.title");
  // Next.js's route announcer reads `document.title` after each navigation,
  // in an effect; a layout effect sets it first, in the UI's language, so
  // "Appearance · Settings" is announced rather than the page before's.
  useLayoutEffect(() => {
    document.title = `${documentTitle} · Teak`;
  }, [documentTitle]);
  const heading = (
    <PageTitle>
      {subpage ? (
        // The sub-page's name is part of the heading, so a screen reader
        // reading headings hears "Settings, Appearance".
        <span className="flex min-w-0 items-center gap-2">
          <Link
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            href="/settings"
          >
            {t("header.title")}
          </Link>
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <span aria-current="page" className="truncate">
            {pageName}
          </span>
        </span>
      ) : (
        t("header.title")
      )}
    </PageTitle>
  );
  return (
    <PageHeader leading={<SidebarToggle className="-ml-2" />} title={heading} />
  );
}
