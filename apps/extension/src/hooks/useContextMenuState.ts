import { useState, useEffect } from "react";

export interface ContextMenuState {
  timestamp: number;
  action: string;
  status: 'loading' | 'success' | 'error';
  error?: string;
  url?: string;
  data?: any;
}

export const useContextMenuState = () => {
  const [state, setState] = useState<ContextMenuState | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const getState = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_CONTEXT_MENU_STATE' });
      setState(response);
      return response;
    } catch (error) {
      console.error('Failed to get context menu state:', error);
      return null;
    }
  };

  useEffect(() => {
    // Get initial state when component mounts
    getState();

    // Set up polling when there's an active loading state
    let pollInterval: NodeJS.Timeout | null = null;

    const startPolling = () => {
      if (pollInterval) return; // Already polling
      
      setIsPolling(true);
      pollInterval = setInterval(async () => {
        const currentState = await getState();
        
        // Stop polling if no state or if not loading
        if (!currentState || currentState.status !== 'loading') {
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
            setIsPolling(false);
          }
        }
      }, 250); // Poll every 250ms for real-time updates
    };

    const stopPolling = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
        setIsPolling(false);
      }
    };

    // Start polling if we have a loading state
    if (state?.status === 'loading') {
      startPolling();
    }

    return () => {
      stopPolling();
    };
  }, [state?.status]);

  const clearState = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_CONTEXT_MENU_STATE' });
      setState(null);
    } catch (error) {
      console.error('Failed to clear context menu state:', error);
    }
  };

  // Check if state is recent (within last 30 seconds)
  const isRecent = state && (Date.now() - state.timestamp) < 30000;

  return {
    state: isRecent ? state : null,
    isPolling,
    clearState,
    refreshState: getState
  };
};