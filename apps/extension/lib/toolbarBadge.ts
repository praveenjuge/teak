import { CARD_ERROR_CODES } from "@teak/convex/shared/constants";
import type { TeakSaveResponse } from "../types/messages";

export type BadgeState = "error" | "none" | "saved" | "saving";

/** White text passes 4.5:1 on each colour, on light and dark toolbars. */
export const BADGES: Record<
  BadgeState,
  { color?: string; text: string; title: string }
> = {
  saved: { text: "✓", color: "#15803d", title: "Already in Teak" },
  saving: { text: "…", color: "#6b7280", title: "Saving to Teak…" },
  error: { text: "!", color: "#dc2626", title: "Couldn't save. Try again." },
  none: { text: "", title: "Save to Teak" },
};

/** How long "!" stays before the icon returns to the page's known state. */
export const ERROR_BADGE_MS = 4000;

/**
 * Paints one tab's icon. Always per tab, so no other tab shows this state.
 * `title` replaces the state's default tooltip.
 */
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
  /** `title` is shown with "!" when the browser won't open the popup. */
  | { openPopup: true; title: string };

export const RATE_LIMITED_TITLE = "Too many saves. Try again in a minute.";

/** What the icon shows after a shortcut save, or that the popup must open. */
export function shortcutOutcome(result: TeakSaveResponse): ShortcutOutcome {
  switch (result.status) {
    case "saved":
      return { badge: "saved", saved: true, title: "Saved to Teak" };
    case "duplicate":
      return { badge: "saved", saved: true, title: "Already in Teak" };
    case "unauthenticated":
      return { openPopup: true, title: "Sign in to Teak to save this page." };
    default:
      if (result.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        return {
          openPopup: true,
          title: "You've reached the free limit. Upgrade to Pro for more.",
        };
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
