import { CARD_ERROR_CODES } from "@teak/convex/shared/constants";
import type { TeakTranslator } from "@teak/i18n";
import type { TeakSaveResponse } from "../types/messages";

export type BadgeState = "error" | "none" | "saved" | "saving";

export const BADGES: Record<
  BadgeState,
  { color?: string; text: string; title: string }
> = {
  saved: { text: "✓", color: "#15803d", title: "Already in Teak" },
  saving: { text: "…", color: "#6b7280", title: "Saving to Teak…" },
  error: { text: "!", color: "#dc2626", title: "Couldn't save. Try again." },
  none: { text: "", title: "Save to Teak" },
};

export const ERROR_BADGE_MS = 4000;

export async function setTabBadge(
  tabId: number,
  state: BadgeState,
  title?: string
): Promise<void> {
  const badge = BADGES[state];
  const calls: Promise<unknown>[] = [
    chrome.action.setBadgeText({ tabId, text: badge.text }),
    chrome.action.setTitle({ tabId, title: title ?? badge.title }),
  ];
  if (badge.color) {
    calls.push(
      chrome.action.setBadgeBackgroundColor({ tabId, color: badge.color })
    );
    if (chrome.action.setBadgeTextColor) {
      calls.push(chrome.action.setBadgeTextColor({ tabId, color: "#ffffff" }));
    }
  }
  // A tab that closed meanwhile rejects; there is nothing left to paint.
  await Promise.all(calls).catch(() => undefined);
}

export type ShortcutOutcome =
  | { badge: BadgeState; saved?: true; title: string }
  | { openPopup: true; title: string };

export const RATE_LIMITED_TITLE = "Too many saves. Try again in a minute.";

/** The tooltip at the card limit, in the account's language. */
export const cardLimitTitle = (t: TeakTranslator<"extension.popup.status">) =>
  `${t("freeLimitReached")}\n${t("upgradeForUnlimited")}`;

export function shortcutOutcome(
  result: TeakSaveResponse,
  limitTitle: string
): ShortcutOutcome {
  switch (result.status) {
    case "saved":
      return { badge: "saved", saved: true, title: "Saved to Teak" };
    case "duplicate":
      return { badge: "saved", saved: true, title: "Already in Teak" };
    case "unauthenticated":
      return { openPopup: true, title: "Sign in to Teak to save this page." };
    default:
      if (result.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        return { openPopup: true, title: limitTitle };
      }
      return {
        badge: "error",
        title:
          result.code === CARD_ERROR_CODES.RATE_LIMITED
            ? RATE_LIMITED_TITLE
            : BADGES.error.title,
      };
  }
}
