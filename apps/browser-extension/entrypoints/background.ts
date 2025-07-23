export default defineBackground(() => {
  console.log('Hello background!', { id: browser.runtime.id });

  // Listen for messages from popup
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_CURRENT_TAB') {
      getCurrentTab()
        .then((tab) => sendResponse({ success: true, tab }))
        .catch((error) =>
          sendResponse({ success: false, error: error.message })
        );
      return true; // Will respond asynchronously
    }
  });

  async function getCurrentTab() {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    return {
      url: tab.url,
      title: tab.title,
      id: tab.id,
    };
  }
});
