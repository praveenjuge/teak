import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../lib/api-client';

interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthenticatedViewProps {
  user: User;
}

interface TabInfo {
  url: string;
  title: string;
  id: number;
}

export function AuthenticatedView({ user }: AuthenticatedViewProps) {
  const [currentTab, setCurrentTab] = useState<TabInfo | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    'loading' | 'saving' | 'success' | 'error'
  >('loading');
  const [hasSaved, setHasSaved] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const saveInProgressRef = useRef(false);

  useEffect(() => {
    if (!hasSaved && !isProcessing && !saveInProgressRef.current) {
      setIsProcessing(true);
      saveInProgressRef.current = true;
      getCurrentTabInfoAndSave();
    }
  }, [hasSaved, isProcessing]);

  const getCurrentTabInfoAndSave = async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_CURRENT_TAB',
      });
      if (response.success) {
        setCurrentTab(response.tab);
        setTabError(null);
        await saveUrl(response.tab);
      } else {
        setTabError(response.error);
        setSaveStatus('error');
        setIsProcessing(false);
        saveInProgressRef.current = false;
      }
    } catch (error) {
      console.error('Error getting current tab:', error);
      setTabError('Failed to get current tab information');
      setSaveStatus('error');
      setIsProcessing(false);
      saveInProgressRef.current = false;
    }
  };

  const saveUrl = async (tab: TabInfo) => {
    if (!(tab && tab.url)) {
      setTabError('No URL to save');
      setSaveStatus('error');
      setIsProcessing(false);
      saveInProgressRef.current = false;
      return;
    }

    if (hasSaved) {
      setIsProcessing(false);
      saveInProgressRef.current = false;
      return; // Prevent duplicate saves
    }

    // Set saved flag immediately to prevent race conditions
    setHasSaved(true);
    setSaveStatus('saving');

    try {
      await apiClient.createCard({
        type: 'url',
        data: {
          url: tab.url,
          title: tab.title,
        },
        metaInfo: {
          source: 'Browser Extension',
          tags: ['bookmark'],
        },
      });

      setSaveStatus('success');
      setIsProcessing(false);
      saveInProgressRef.current = false;

      // Close popup after successful save
      setTimeout(() => {
        window.close();
      }, 1000);
    } catch (error) {
      console.error('Error saving URL:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to save URL';

      if (errorMessage.includes('URL already exists')) {
        setTabError('URL already saved');
        setSaveStatus('success');
        setIsProcessing(false);
        saveInProgressRef.current = false;
        setTimeout(() => {
          window.close();
        }, 1000);
      } else {
        setTabError('Failed to save URL');
        setSaveStatus('error');
        setHasSaved(false); // Allow retry on error
        setIsProcessing(false);
        saveInProgressRef.current = false;
      }
    }
  };

  return (
    <div className="authenticated-view">
      <div className="current-tab-info">
        {currentTab && (
          <div className="tab-details">
            <p className="tab-title">{currentTab.title}</p>
            <p className="tab-url">{currentTab.url}</p>
          </div>
        )}

        <div className="save-status">
          {saveStatus === 'loading' && <p>Loading current tab...</p>}
          {saveStatus === 'saving' && <p>Saving URL...</p>}
          {saveStatus === 'success' && !tabError && (
            <p>✓ URL saved successfully!</p>
          )}
          {saveStatus === 'success' && tabError === 'URL already saved' && (
            <p>✓ URL already saved</p>
          )}
          {saveStatus === 'error' && <p>✗ Failed to save URL</p>}
        </div>

        {tabError && tabError !== 'URL already saved' && (
          <div className="error">
            <p>{tabError}</p>
          </div>
        )}
      </div>
    </div>
  );
}
