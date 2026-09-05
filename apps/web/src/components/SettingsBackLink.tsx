"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

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
    previousUrl.pathname === "/";
  return isHome ? previousEntry : null;
}

export function SettingsBackLink() {
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
      className="inline-block font-medium text-primary"
      href="/"
      onClick={handleClick}
    >
      &larr; Back
    </Link>
  );
}
