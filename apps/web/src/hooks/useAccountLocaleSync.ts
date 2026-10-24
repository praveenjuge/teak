"use client";

import { api } from "@teak/convex";
import { isSupportedLocale, PSEUDO_LOCALE } from "@teak/i18n";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLocaleSwitch } from "@/components/providers/LocaleProvider";
import { useQuery } from "@/lib/convexQueryHooks";
import { setPostHogPersonProperties } from "@/lib/posthog-client";

/**
 * Keeps this browser on the account's language. The account is the source of
 * truth; the cookie only lets the server render the right language first.
 * It acts when the account's value first loads or changes (another tab or
 * device), so it never undoes a switch whose save is still in flight.
 */
export function useAccountLocaleSync() {
  const preferences = useQuery(api.settings.preferences.getPreferences, {});
  const localeSwitch = useLocaleSwitch();
  const router = useRouter();
  const lastSeen = useRef<string | null>(null);
  const accountLocale = isSupportedLocale(preferences?.locale)
    ? preferences.locale
    : undefined;
  const current = localeSwitch?.locale;
  const switchLocale = localeSwitch?.switchLocale;

  useEffect(() => {
    if (
      !(accountLocale && switchLocale) ||
      accountLocale === lastSeen.current
    ) {
      return;
    }
    lastSeen.current = accountLocale;
    setPostHogPersonProperties({ locale: accountLocale });
    // The development pseudo-locale is a local override.
    if (current === accountLocale || current === PSEUDO_LOCALE) {
      return;
    }
    switchLocale(accountLocale)
      .then(() => router.refresh())
      .catch(() => undefined);
  }, [accountLocale, current, router, switchLocale]);
}
