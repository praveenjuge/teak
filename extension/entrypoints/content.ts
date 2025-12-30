// Content script is no longer needed for context menu functionality
// The background script now handles content extraction directly using chrome.scripting API
// This file is kept minimal in case future features require content script functionality

export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // No context menu handling needed here anymore
  },
});
