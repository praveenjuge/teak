import type { PlasmoCSConfig } from "plasmo";
import type { ContextMenuMessage } from "./types/contextMenu";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_start"
};

// Menu item IDs
const MENU_ITEMS = {
  SAVE_URL: 'teak-save-url',
  SAVE_IMAGE: 'teak-save-image', 
  SAVE_TEXT: 'teak-save-text'
} as const;

// Create context menu items when extension is installed/enabled
chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

// Recreate menus when extension starts up
chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
});

function createContextMenus() {
  // Remove all existing context menu items
  chrome.contextMenus.removeAll(() => {
    // Save current page URL (shows when right-clicking on page)
    chrome.contextMenus.create({
      id: MENU_ITEMS.SAVE_URL,
      title: 'Save Page to Teak',
      contexts: ['page']
    });

    // Save selected text (shows when text is selected and right-clicked)
    chrome.contextMenus.create({
      id: MENU_ITEMS.SAVE_TEXT,
      title: 'Save Text to Teak',
      contexts: ['selection']
    });

    // Save image (shows when right-clicking on an image)
    chrome.contextMenus.create({
      id: MENU_ITEMS.SAVE_IMAGE,
      title: 'Save Image to Teak',
      contexts: ['image']
    });
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  try {
    let message: ContextMenuMessage;

    switch (info.menuItemId) {
      case MENU_ITEMS.SAVE_URL:
        message = {
          action: 'saveUrl',
          data: {
            url: info.pageUrl,
            pageTitle: tab.title
          }
        };
        break;

      case MENU_ITEMS.SAVE_TEXT:
        if (!info.selectionText) return;
        message = {
          action: 'saveText',
          data: {
            selectedText: info.selectionText,
            url: info.pageUrl,
            pageTitle: tab.title
          }
        };
        break;

      case MENU_ITEMS.SAVE_IMAGE:
        if (!info.srcUrl) return;
        message = {
          action: 'saveImage',
          data: {
            imageUrl: info.srcUrl,
            url: info.pageUrl,
            pageTitle: tab.title
          }
        };
        break;

      default:
        return;
    }

    // Send message to content script
    chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    console.error('Error handling context menu click:', error);
  }
});