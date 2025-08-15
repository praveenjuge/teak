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

// Notification component
function NotificationToast({ notification, onClose }: { 
  notification: NotificationData; 
  onClose: () => void; 
}) {
  const bgColor = {
    success: "bg-green-50 border-green-200",
    error: "bg-red-50 border-red-200", 
    loading: "bg-blue-50 border-blue-200"
  }[notification.type];

  const textColor = {
    success: "text-green-800",
    error: "text-red-800",
    loading: "text-blue-800"
  }[notification.type];

  const icon = {
    success: "✓",
    error: "✗",
    loading: "⟳"
  }[notification.type];

  return (
    <div className={`fixed top-4 right-4 z-50 p-3 rounded-lg border shadow-lg ${bgColor} ${textColor} max-w-sm`}>
      <div className="flex items-center gap-2">
        <span className={notification.type === 'loading' ? 'animate-spin' : ''}>
          {icon}
        </span>
        <span className="text-sm font-medium">{notification.message}</span>
        <button 
          onClick={onClose}
          className="ml-2 text-gray-400 hover:text-gray-600"
        >
          ×
        </button>
      </div>
    </div>
  );
}

// Main content script component 
function ContextMenuHandler() {
  const { performSave, createNotification } = useContextMenuSave();
  const { isSignedIn } = useAuth();

  React.useEffect(() => {
    const messageListener = async (
      message: ContextMenuMessage,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: any) => void
    ) => {
      // Only handle messages from our extension
      if (sender.id !== chrome.runtime.id) return;

      // Check if user is authenticated
      if (!isSignedIn) {
        showNotification(createNotification('error', 'Please sign in to save items to Teak'));
        return;
      }

      // Show loading notification
      const loadingMessage = {
        saveUrl: 'Saving URL to Teak...',
        saveImage: 'Saving image to Teak...',
        saveText: 'Saving text to Teak...'
      }[message.action];

      showNotification(createNotification('loading', loadingMessage));

      try {
        const result = await performSave(message.action, message.data);
        
        if (result.success) {
          const successMessage = {
            saveUrl: 'URL saved to Teak!',
            saveImage: 'Image saved to Teak!',
            saveText: 'Text saved to Teak!'
          }[message.action];
          
          showNotification(createNotification('success', successMessage));
        } else {
          showNotification(createNotification('error', result.error || 'Failed to save to Teak'));
        }
      } catch (error) {
        console.error('Context menu save error:', error);
        showNotification(createNotification('error', 'Failed to save to Teak'));
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
    };
  }, [isSignedIn, performSave, createNotification]);

  return null;
}

// Notification system
let notificationContainer: HTMLDivElement | null = null;
let notificationRoot: any = null;

function showNotification(notification: NotificationData) {
  // Create container if it doesn't exist
  if (!notificationContainer) {
    notificationContainer = document.createElement('div');
    notificationContainer.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      z-index: 9999;
      pointer-events: none;
    `;
    document.body.appendChild(notificationContainer);
    notificationRoot = createRoot(notificationContainer);
  }

  const onClose = () => {
    if (notificationRoot && notificationContainer) {
      notificationRoot.render(null);
      document.body.removeChild(notificationContainer);
      notificationContainer = null;
      notificationRoot = null;
    }
  };

  // Auto-close after duration
  if (notification.duration) {
    setTimeout(onClose, notification.duration);
  }

  notificationRoot.render(
    <div style={{ pointerEvents: 'auto' }}>
      <NotificationToast notification={notification} onClose={onClose} />
    </div>
  );
}

// Initialize the context menu handler
if (PUBLISHABLE_KEY) {
  const initContextMenu = () => {
    // Create a hidden div to mount our React context
    const contextDiv = document.createElement('div');
    contextDiv.style.display = 'none';
    document.body.appendChild(contextDiv);
    
    const root = createRoot(contextDiv);
    root.render(
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} syncHost={SYNC_HOST}>
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <ContextMenuHandler />
        </ConvexProviderWithClerk>
      </ClerkProvider>
    );
  };

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initContextMenu);
  } else {
    initContextMenu();
  }
}
