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
  /** Stops badge checks painting the tab; returns the release. */
  hold: (tabId: number) => () => void;
  markSaved: (url: string) => Promise<void>;
  openPopup: () => Promise<void>;
  paint: (tabId: number, state: BadgeState, title?: string) => Promise<void>;
  /** Re-checks the tab once a save's own badge is done. */
  refresh: (tab: chrome.tabs.Tab) => Promise<void>;
  /** Queues the page in the pending-save store without signing in. */
  save: (url: string) => Promise<TeakSaveResponse>;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Saves the active tab's page from the keyboard shortcut, showing progress
 * on the toolbar icon. A second press for a page already saving waits for
 * the first save instead of starting another.
 */
export function createSaveShortcut({
  hold,
  markSaved,
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
        pending = save(url).finally(() => running.delete(url));
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
      if (outcome.saved) {
        await markSaved(url);
        await paint(tab.id, outcome.badge, outcome.title);
        return;
      }
      restore = true;
      await flashError(tab, outcome.title);
    } finally {
      release();
      if (restore) {
        await refresh(tab);
      }
    }
  };
}
