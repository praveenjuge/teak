type ActionApi = { openPopup?: () => Promise<void> } | null | undefined;

/**
 * Opens the toolbar popup and says whether it opened. Browsers without
 * `action.openPopup` (Chrome before 127 and some Chromium browsers) and a
 * call outside a user action both answer false instead of throwing, so the
 * save that asked for the popup still goes ahead.
 */
export function openActionPopup(
  action: ActionApi = chrome.action
): Promise<boolean> {
  if (typeof action?.openPopup !== "function") {
    return Promise.resolve(false);
  }
  try {
    return Promise.resolve(action.openPopup()).then(
      () => true,
      () => false
    );
  } catch {
    return Promise.resolve(false);
  }
}
