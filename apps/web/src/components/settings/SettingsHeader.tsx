"use client";

import { useTranslations } from "@teak/i18n/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "vadivam-react";
import { SidebarToggle } from "@/components/sidebar";
import { settingsSectionForPath } from "@/lib/settingsSections";
import { PageHeader, PageTitle } from "@/screens";

/** Settings' page header; a Settings page shows where it sits under it. */
export function SettingsHeader() {
  const t = useTranslations("settings");
  const section = settingsSectionForPath(usePathname());
  const subpage = section && section.id !== "account" ? section : null;
  const heading = (
    <PageTitle
      trailing={
        subpage ? (
          <>
            <ChevronRight
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span aria-current="page" className="truncate font-medium text-sm">
              {t(`nav.${subpage.id}`)}
            </span>
          </>
        ) : null
      }
    >
      {subpage ? (
        <Link
          className="text-muted-foreground transition-colors hover:text-foreground"
          href="/settings"
        >
          {t("header.title")}
        </Link>
      ) : (
        t("header.title")
      )}
    </PageTitle>
  );
  return (
    <PageHeader leading={<SidebarToggle className="-ml-2" />} title={heading} />
  );
}
