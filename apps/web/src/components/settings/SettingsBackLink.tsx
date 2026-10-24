"use client";

import { useTranslations } from "@teak/i18n/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { ArrowLeft } from "vadivam-react";
import { SidebarToggle } from "@/components/sidebar";
import { libraryViewForPath } from "@/lib/libraryViews";
import { PageHeader, PageTitle } from "@/screens";

interface NavigationEntry {
  getState: () => unknown;
  index: number;
  url: string | null;
}

interface NavigationHistory extends EventTarget {
  currentEntry?: NavigationEntry;
  entries: () => NavigationEntry[];
}

function getPreviousHomeEntry(): NavigationEntry | null {
  const navigation = (window as Window & { navigation?: NavigationHistory })
    .navigation;
  const currentIndex = navigation?.currentEntry?.index;
  if (!(navigation && currentIndex)) {
    return null;
  }

  const previousEntry = navigation
    .entries()
    .find((entry) => entry.index === currentIndex - 1);
  if (!previousEntry?.url) {
    return null;
  }

  const previousUrl = new URL(previousEntry.url);
  const isHome =
    previousUrl.origin === window.location.origin &&
    libraryViewForPath(previousUrl.pathname) !== null;
  return isHome ? previousEntry : null;
}

export function SettingsBackLink() {
  const tc = useTranslations("common");
  const router = useRouter();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const previousHomeEntry = getPreviousHomeEntry();
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !previousHomeEntry
    ) {
      return;
    }

    event.preventDefault();
    const state = previousHomeEntry.getState() as
      | { __teakHomeScrollY?: unknown }
      | undefined;
    const scrollY = state?.__teakHomeScrollY;
    const navigation = (window as Window & { navigation?: NavigationHistory })
      .navigation;
    if (typeof scrollY === "number") {
      navigation?.addEventListener(
        "navigatesuccess",
        () => requestAnimationFrame(() => window.scrollTo(0, scrollY)),
        { once: true }
      );
    }
    router.back();
  };

  return (
    <Link
      aria-label={tc("back")}
      className="-ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      href="/"
      onClick={handleClick}
      title={tc("back")}
    >
      <ArrowLeft className="size-4" />
    </Link>
  );
}

export function SettingsHeader() {
  const t = useTranslations("settings.header");
  return (
    <PageHeader
      leading={<SidebarToggle className="-ml-2" />}
      title={<PageTitle icon={<SettingsBackLink />}>{t("title")}</PageTitle>}
    />
  );
}
