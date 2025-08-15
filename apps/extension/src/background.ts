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

// Store the context menu action state for the popup to read
let contextMenuState: {
  timestamp: number;
  action: string;
  status: 'loading' | 'success' | 'error';
  error?: string;
  url?: string;
  data?: any;
} | null = null;

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

    // Set loading state immediately
    contextMenuState = {
      timestamp: Date.now(),
      action: message.action,
      status: 'loading',
      url: info.pageUrl,
      data: message.data
    };

    // Open the extension popup immediately to show loading state
    chrome.action.openPopup();

    // Send message to content script and wait for response
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      // Update the state with the result
      contextMenuState = {
        timestamp: Date.now(),
        action: message.action,
        status: response?.success ? 'success' : 'error',
        error: response?.error,
        url: info.pageUrl,
        data: message.data
      };
    });
  } catch (error) {
    console.error('Error handling context menu click:', error);
    // Set error state
    contextMenuState = {
      timestamp: Date.now(),
      action: 'unknown',
      status: 'error',
      error: 'Failed to process context menu action',
      url: info.pageUrl
    };
    chrome.action.openPopup();
  }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_IMAGE') {
    fetchImageAsDataUrl(message.imageUrl)
      .then(({ dataUrl, mimeType, size }) => {
        sendResponse({
          success: true,
          data: { dataUrl, mimeType, size }
        });
      })
      .catch(error => {
        console.error('Failed to fetch image in background:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      });
    
    // Return true to indicate we will send response asynchronously
    return true;
  }

  if (message.type === 'GET_CONTEXT_MENU_STATE') {
    sendResponse(contextMenuState);
    return true;
  }

  if (message.type === 'CLEAR_CONTEXT_MENU_STATE') {
    contextMenuState = null;
    sendResponse({ success: true });
    return true;
  }
});

// Fetch image and convert to data URL in background script (has permissions to bypass CORS)
async function fetchImageAsDataUrl(imageUrl: string): Promise<{ dataUrl: string; mimeType: string; size: number }> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const mimeType = blob.type || 'image/jpeg';
    
    // Convert blob to data URL
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to convert blob to data URL'));
      reader.readAsDataURL(blob);
    });
    
    return { dataUrl, mimeType, size: blob.size };
  } catch (error) {
    throw new Error(`Network error fetching image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}