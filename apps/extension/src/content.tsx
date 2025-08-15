import type { PlasmoCSConfig } from "plasmo";
import React from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, useAuth } from "@clerk/chrome-extension";
import type { ContextMenuMessage, NotificationData } from "./types/contextMenu";
import { useContextMenuSave } from "./hooks/useContextMenuSave";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
};

const convex = new ConvexReactClient(process.env.PLASMO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false
});

const PUBLISHABLE_KEY = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const SYNC_HOST = process.env.PLASMO_PUBLIC_CLERK_SYNC_HOST;


// Main content script component 
function ContextMenuHandler() {
  const { performSave } = useContextMenuSave();
  const { isSignedIn } = useAuth();

  React.useEffect(() => {
    const messageListener = (
      message: ContextMenuMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: any) => void
    ) => {
      // Only handle messages from our extension
      if (sender.id !== chrome.runtime.id) return;

      // Check if user is authenticated
      if (!isSignedIn) {
        // Send error response back to background script
        sendResponse({ success: false, error: 'Please sign in to save items to Teak' });
        return;
      }

      // Handle async operation
      const handleSave = async () => {
        try {
          const result = await performSave(message.action, message.data);
          // Send result back to background script
          sendResponse(result);
        } catch (error) {
          console.error('Context menu save error:', error);
          sendResponse({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Failed to save to Teak' 
          });
        }
      };

      handleSave();
      
      // Return true to indicate we will send response asynchronously
      return true;
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [isSignedIn, performSave]);

  return null;
}


// Initialize the context menu handler
if (PUBLISHABLE_KEY) {
  const initContextMenu = () => {
    try {
      // Create a hidden div to mount our React context
      const contextDiv = document.createElement('div');
      contextDiv.style.display = 'none';
      contextDiv.id = 'teak-extension-context';
      
      // Check if already initialized
      if (document.getElementById('teak-extension-context')) {
        console.warn('Teak extension already initialized');
        return;
      }
      
      document.body.appendChild(contextDiv);
      
      const root = createRoot(contextDiv);
      root.render(
        <ClerkProvider publishableKey={PUBLISHABLE_KEY} syncHost={SYNC_HOST}>
          <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
            <ContextMenuHandler />
          </ConvexProviderWithClerk>
        </ClerkProvider>
      );
      
      console.log('Teak extension initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Teak extension:', error);
    }
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContextMenu);
  } else {
    // Wait a bit for the body to be available
    if (document.body) {
      initContextMenu();
    } else {
      setTimeout(initContextMenu, 100);
    }
  }
} else {
  console.error('Teak extension: PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY not found');
}
