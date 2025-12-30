import type { ContextMenuAction } from '../types/contextMenu';

// Check if a URL is restricted (can't inject scripts)
function isRestrictedUrl(url?: string): boolean {
  if (!url) return true;

  const restrictedPrefixes = [
    'chrome://',
    'chrome-extension://',
    'moz-extension://',
    'edge-extension://',
    'about:',
    'data:',
    'file://',
    'view-source:',
    'filesystem:'
  ];

  return restrictedPrefixes.some(prefix => url.startsWith(prefix));
}

export default defineBackground(() => {

  // Create context menus when extension starts
  chrome.runtime.onStartup.addListener(createContextMenus);
  chrome.runtime.onInstalled.addListener(createContextMenus);

  // Handle context menu clicks
  chrome.contextMenus.onClicked.addListener(handleContextMenuClick);

  // Create context menu items
  function createContextMenus() {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'save-page',
        title: 'Save Page to Teak',
        contexts: ['page']
      });

      chrome.contextMenus.create({
        id: 'save-text',
        title: 'Save Text to Teak',
        contexts: ['selection']
      });

    });
  }

  // Handle context menu clicks with enhanced error handling
  async function handleContextMenuClick(
    info: chrome.contextMenus.OnClickData,
    tab?: chrome.tabs.Tab
  ) {
    if (!tab?.id) {
      return;
    }

    const action = info.menuItemId as ContextMenuAction;

    try {

      // Check if the current page is restricted
      if (isRestrictedUrl(tab.url)) {
        throw new Error(`Cannot save content from ${new URL(tab.url || '').protocol} pages. Try using the extension on regular web pages.`);
      }

      // Extract content based on action
      let content: string | undefined;
      let errorMessage: string | undefined;

      switch (action) {
        case 'save-page':
          content = tab.url;
          if (!content) {
            errorMessage = 'Could not access page URL';
          }
          break;

        case 'save-text':
          // Try to extract selected text with better error handling
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: () => {
                const selection = window.getSelection();
                const selectedText = selection ? selection.toString().trim() : '';

                // If no text selected, try to get page title as fallback
                if (!selectedText) {
                  return {
                    content: document.title || '',
                    fallback: true
                  };
                }

                return {
                  content: selectedText,
                  fallback: false
                };
              }
            });

            const result = results[0]?.result;
            if (result?.content) {
              content = result.content;
            } else {
              errorMessage = 'No text selected and could not access page content';
            }
          } catch {
            // Fallback: use page title if available
            if (tab.title) {
              content = tab.title;
            } else {
              errorMessage = 'Could not access page content. Please select text and try again.';
            }
          }
          break;

      }

      if (!content) {
        throw new Error(errorMessage || 'No content to save');
      }

      // Store content for processing
      const contextMenuState = {
        action,
        timestamp: Date.now(),
        status: 'saving',
        content
      };

      await chrome.storage.local.set({
        contextMenuSave: contextMenuState
      });

      // Open popup to show progress and handle saving
      void chrome.action.openPopup();

    } catch (error) {

      const errorMessage = error instanceof Error ? error.message : 'Failed to save content';

      await chrome.storage.local.set({
        contextMenuSave: {
          action,
          timestamp: Date.now(),
          status: 'error',
          error: errorMessage
        }
      });

      // Open popup to show error
      void chrome.action.openPopup();
    }
  }

  // Initialize context menus immediately
  void createContextMenus();
});
