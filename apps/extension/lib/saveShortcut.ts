import type { TeakSaveResponse } from "../types/messages";
import { restrictedUrlMessage } from "./restrictedUrl";
import { checkableUrl } from "./savedPageCheck";
import {
  type BadgeState,
  ERROR_BADGE_MS,
  shortcutOutcome,
} from "./toolbarBadge";

export const SAVE_PAGE_COMMAND = "save-page";

export interface SaveShortcutDependencies {
  /** The address the tab shows now, or undefined once it closed. */
  currentUrl: (tabId: number) => Promise<string | undefined>;
  /** Stops badge checks painting the tab; returns the release. */
  hold: (tabId: number) => () => void;
  openPopup: () => Promise<void>;
  paint: (tabId: number, state: BadgeState, title?: string) => Promise<void>;
  /** Re-checks the tab once a save's own badge is done. */
  refresh: (tab: chrome.tabs.Tab) => Promise<void>;
  /**
   * Queues the page in the pending-save store without signing in; `tabId`
   * is the tab whose page becomes the link's saved copy.
   */
  save: (url: string, tabId: number) => Promise<TeakSaveResponse>;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Saves the active tab's page from the keyboard shortcut, showing progress
 * on the toolbar icon. A second press for a page already saving waits for
 * the first save instead of starting another.
 */
export function createSaveShortcut({
  currentUrl,
  hold,
  openPopup,
  paint,
  refresh,
  save,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: SaveShortcutDependencies) {
  const running = new Map<string, Promise<TeakSaveResponse>>();

  const flashError = async (tab: chrome.tabs.Tab, title: string) => {
    if (tab.id === undefined) {
      return;
    }
    await paint(tab.id, "error", title);
    await wait(ERROR_BADGE_MS);
  };

  return async (tab: chrome.tabs.Tab | undefined) => {
    if (tab?.id === undefined) {
      return;
    }
    const release = hold(tab.id);
    let restore = false;
    try {
      const url = checkableUrl(tab.url);
      if (!url) {
        restore = true;
        await flashError(tab, restrictedUrlMessage(tab.url));
        return;
      }
      await paint(tab.id, "saving");
      let pending = running.get(url);
      if (!pending) {
        pending = save(url, tab.id).finally(() => running.delete(url));
        running.set(url, pending);
      }
      const outcome = shortcutOutcome(await pending);
      if ("openPopup" in outcome) {
        restore = true;
        // Firefox opens the popup only while a user action is handled, and
        // the save took longer than that; the icon says what to do instead.
        if (
          await openPopup().then(
            () => true,
            () => false
          )
        ) {
          return;
        }
        await flashError(tab, outcome.title);
        return;
      }
      // The pending-save store has already marked the page as saved.
      if (outcome.saved) {
        // A tab that moved on while the page saved gets its new page's badge.
        if (checkableUrl(await currentUrl(tab.id)) !== url) {
          restore = true;
          return;
        }
        await paint(tab.id, outcome.badge, outcome.title);
        return;
      }
      restore = true;
      await flashError(tab, outcome.title);
    } finally {
      release();
      if (restore) {
        await refresh({
          ...tab,
          url: (await currentUrl(tab.id)) ?? tab.url,
        });
      }
    }
  };
}
