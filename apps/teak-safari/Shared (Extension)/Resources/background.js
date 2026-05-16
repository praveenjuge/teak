browser.runtime.onInstalled.addListener(() => {
    browser.storage.local.set({ installedAt: Date.now() });
});
