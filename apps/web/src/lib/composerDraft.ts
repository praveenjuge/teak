/**
 * The composer's unsaved note, kept in this browser per account so a reload
 * or a closed tab doesn't lose it. Storage can be missing or full (a private
 * window, blocked site data, a huge note): reads then come back empty and
 * writes say they failed, so the composer can warn before the tab closes.
 */

const KEY_PREFIX = "teak:composer-draft:";

type DraftStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export const composerDraftKey = (accountId: string) =>
  `${KEY_PREFIX}${accountId}`;

const browserStorage = (): DraftStorage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function readComposerDraft(
  accountId: string,
  storage: DraftStorage | null = browserStorage()
): string {
  try {
    return storage?.getItem(composerDraftKey(accountId)) ?? "";
  } catch {
    return "";
  }
}

/** Stores the draft, or clears it once it holds no text. True when kept. */
export function storeComposerDraft(
  accountId: string,
  content: string,
  storage: DraftStorage | null = browserStorage()
): boolean {
  if (!storage) {
    return false;
  }
  try {
    if (content.trim()) {
      storage.setItem(composerDraftKey(accountId), content);
    } else {
      storage.removeItem(composerDraftKey(accountId));
    }
    return true;
  } catch {
    return false;
  }
}
