"use client";

import { api } from "@teak/convex";
import { captureEvent } from "@teak/convex/shared/analytics";
import {
  createTeakTranslator,
  isSupportedLocale,
  type Locale,
  loadMessages,
  type UiLocale,
  withEnglishFallback,
} from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useLocaleSwitch } from "@/components/providers/LocaleProvider";
import { TOAST_IDS, UNDO_TOAST_DURATION_MS } from "@/constants/toast";
import { setPostHogPersonProperties } from "@/lib/posthog-client";

export interface LanguageSetting {
  locale: UiLocale;
  onChange: (next: Locale) => void;
  pending: boolean;
}

/**
 * Settings → Language: switches the app in place, saves the choice to the
 * account, and offers Undo. A failed save switches back.
 */
export function useLanguageSetting(): LanguageSetting | null {
  const localeSwitch = useLocaleSwitch();
  const t = useTranslations("settings.language");
  const setLocale = useMutation(api.settings.preferences.setLocale);
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const change = useCallback(
    async (next: Locale, from: UiLocale) => {
      if (!localeSwitch || next === from) {
        return;
      }
      setPending(true);
      try {
        await localeSwitch.switchLocale(next);
        await setLocale({ locale: next });
      } catch {
        await localeSwitch.switchLocale(from).catch(() => undefined);
        // `t` still speaks the language the person came from.
        toast.error(t("changeFailed"), { id: TOAST_IDS.language });
        return;
      } finally {
        setPending(false);
      }
      router.refresh();
      captureEvent("locale_changed", { from, to: next });
      setPostHogPersonProperties({ locale: next });
      // Said in the new language, which this render's `t` doesn't speak yet.
      const tNext = createTeakTranslator(
        next,
        withEnglishFallback(await loadMessages(next))
      );
      const undoTo = isSupportedLocale(from) ? from : null;
      toast.success(tNext("settings.language.changed"), {
        id: TOAST_IDS.language,
        duration: UNDO_TOAST_DURATION_MS,
        action: undoTo
          ? {
              label: tNext("common.undo"),
              onClick: () => {
                change(undoTo, next).catch(() => undefined);
              },
            }
          : undefined,
      });
    },
    [localeSwitch, router, setLocale, t]
  );

  if (!localeSwitch) {
    return null;
  }
  return {
    locale: localeSwitch.locale,
    onChange: (next) => {
      change(next, localeSwitch.locale).catch(() => undefined);
    },
    pending,
  };
}
