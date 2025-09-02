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
    'file://'
  ];
  
  return restrictedPrefixes.some(prefix => url.startsWith(prefix));
}

export default defineBackground(() => {
  console.log('Teak extension background script started', { id: browser.runtime.id });
  
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
        title: 'Save page to Teak',
        contexts: ['page']
      });
      
      chrome.contextMenus.create({
        id: 'save-text',
        title: 'Save text to Teak',
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
      console.error('No tab ID available');
      return;
    }
    
    const action = info.menuItemId as ContextMenuAction;
    
    try {
      console.log('Context menu action started:', action);
      
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
              if (result.fallback) {
                console.log('No text selected, used page title as fallback');
              }
            } else {
              errorMessage = 'No text selected and could not access page content';
            }
          } catch (scriptError) {
            console.error('Failed to extract selected text:', scriptError);
            
            // Fallback: use page title if available
            if (tab.title) {
              content = tab.title;
              console.log('Script injection failed, using page title as fallback');
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
      
      console.log('Context menu content extracted and stored:', contextMenuState);
      
      // Open popup to show progress and handle saving
      chrome.action.openPopup();
      
    } catch (error) {
      console.error('Context menu save error:', error);
      
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
      chrome.action.openPopup();
    }
  }
  
  // Initialize context menus immediately
  createContextMenus();
});
