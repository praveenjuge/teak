import { useEffect, useState } from "react";
import { Loader2, ArrowRight } from "lucide-react";
import { useAutoSaveUrl } from "../../hooks/useAutoSaveUrl";
import { useContextMenuSave } from "../../hooks/useContextMenuSave";
import { useWebAppSession } from "../../hooks/useWebAppSession";
import { authClient } from "../../lib/auth-client";
import { getAuthErrorMessage } from "../../utils/getAuthErrorMessage";

// Error code constant for card limit - should match convex/shared/constants.ts
const CARD_LIMIT_REACHED_CODE = "CARD_LIMIT_REACHED";

// Helper to check if an error is the card limit error
function isCardLimitError(errorMessage: string | undefined): boolean {
  return !!errorMessage && errorMessage.includes(CARD_LIMIT_REACHED_CODE);
}

// Upgrade prompt component for when free tier limit is reached
function UpgradePrompt() {
  const baseUrl = import.meta.env.DEV
    ? "http://localhost:3000"
    : "https://app.teakvault.com";

  const handleUpgradeClick = () => {
    chrome.tabs.create({ url: `${baseUrl}/settings` });
    window.close();
  };

  return (
    <div className="w-96 min-h-96 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
        <svg
          className="w-5 h-5 text-amber-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-900">
          You&apos;ve reached your free tier limit.
        </p>
        <p className="text-xs text-gray-600">
          Upgrade to Pro for unlimited cards.
        </p>
      </div>
      <button
        type="button"
        onClick={handleUpgradeClick}
        className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
      >
        Upgrade to Pro
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

type SessionUser = {
  id: string;
  email: string;
  name?: string;
  image?: string;
};

function App() {
  const {
    data: session,
    isPending,
    error: sessionError,
    refetch,
  } = useWebAppSession();

  if (isPending) {
    return (
      <div className="w-96 min-h-96 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-red-600 animate-spin" />
      </div>
    );
  }

  if (sessionError) {
    return (
      <SessionErrorState
        message={getAuthErrorMessage(
          sessionError,
          "We couldn't load your session."
        )}
        onRetry={() => refetch()}
      />
    );
  }

  if (!session) {
    return <AuthPanel onLoginSuccess={() => refetch()} />;
  }

  return <AuthenticatedPopup user={session.user} />;
}

function SessionErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="w-96 min-h-96 flex flex-col items-center justify-center gap-4 p-5 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="./icon.svg" alt="Teak Logo" className="h-6" />
      <p className="text-sm text-red-600">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Try again
      </button>
    </div>
  );
}

function AuthPanel({ onLoginSuccess }: { onLoginSuccess: () => void }) {
  const baseUrl = import.meta.env.DEV
    ? "http://localhost:3000"
    : "https://app.teakvault.com";

  const handleLogin = () => {
    chrome.tabs.create({ url: `${baseUrl}/login` });
    window.close();
  };

  const handleRegister = () => {
    chrome.tabs.create({ url: `${baseUrl}/register` });
    window.close();
  };

  return (
    <div className="w-96 min-h-96 flex flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="space-y-3 flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="./icon.svg" alt="Teak Logo" className="h-5" />
        <h1 className="text-base font-semibold">Save Anything. Anywhere.</h1>
      </div>

      <div className="w-full space-y-3">
        <button
          type="button"
          onClick={handleLogin}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
        >
          Login
        </button>

        <button
          type="button"
          onClick={handleRegister}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          Create Account
        </button>
      </div>
    </div>
  );
}

function AuthenticatedPopup({ user }: { user: SessionUser }) {
  const { state: contextMenuState, isRecentSave } = useContextMenuSave();
  const { state, error } = useAutoSaveUrl(!isRecentSave);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Auto-close popup after successful save
  useEffect(() => {
    const isAutoSaveSuccess = state === "success";
    const isContextMenuSuccess =
      isRecentSave && contextMenuState.status === "success";

    if (isAutoSaveSuccess || isContextMenuSuccess) {
      const timer = setTimeout(() => {
        window.close();
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [state, isRecentSave, contextMenuState.status]);

  const renderStatus = () => {
    if (isRecentSave) {
      return renderContextMenuStatus();
    }
    return renderAutoSaveStatus();
  };

  const renderContextMenuStatus = () => {
    const getContextMenuMessage = () => {
      switch (contextMenuState.action) {
        case "save-page":
          return "Page saved!";
        case "save-text":
          return "Text saved!";
        default:
          return "Saved to Teak!";
      }
    };

    switch (contextMenuState.status) {
      case "saving":
        return (
          <div className="w-96 min-h-96 flex items-center justify-center gap-2 p-3">
            <Loader2 className="w-4 h-4 text-red-600 animate-spin" />
            <span className="text-sm text-red-700">Saving to Teak...</span>
          </div>
        );
      case "success":
        return (
          <div className="w-96 min-h-96 flex items-center justify-center gap-2 p-3">
            <svg
              className="w-4 h-4 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-sm text-green-700">
              {getContextMenuMessage()}
            </span>
          </div>
        );
      case "error":
        // Show upgrade prompt for card limit errors
        if (isCardLimitError(contextMenuState.error)) {
          return <UpgradePrompt />;
        }
        return (
          <div className="w-96 min-h-96 flex flex-col items-center justify-center gap-1 p-3">
            <div className="flex items-center justify-center gap-2">
              <svg
                className="w-4 h-4 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span className="text-sm text-red-700">Failed to save</span>
            </div>
            {contextMenuState.error && (
              <span className="text-xs text-red-600">
                {contextMenuState.error}
              </span>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  const renderAutoSaveStatus = () => {
    switch (state) {
      case "loading":
        return (
          <div className="w-96 min-h-96 flex items-center justify-center gap-2 p-3">
            <Loader2 className="w-4 h-4 text-red-600 animate-spin" />
            <span className="text-sm text-red-700">Adding to Teak...</span>
          </div>
        );
      case "success":
        return (
          <div className="w-96 min-h-96 flex items-center justify-center gap-2 p-3">
            <svg
              className="w-4 h-4 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="text-sm text-green-700">Added to Teak!</span>
          </div>
        );
      case "error":
        // Show upgrade prompt for card limit errors
        if (isCardLimitError(error)) {
          return <UpgradePrompt />;
        }
        return (
          <div className="w-96 min-h-96 flex flex-col items-center justify-center gap-1 p-3">
            <div className="flex items-center justify-center gap-2">
              <svg
                className="w-4 h-4 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span className="text-sm text-red-700">Failed to save</span>
            </div>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        );
      case "invalid-url":
        return (
          <div className="w-96 min-h-96 flex items-center justify-center gap-2 p-3">
            <svg
              className="w-4 h-4 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm text-gray-700">
              Can&apos;t save this page
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-96 min-h-96 relative">
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between gap-2 p-3">
        <a
          href="https://app.teakvault.com"
          target="_blank"
          rel="noopener noreferrer"
          title="Open Teak"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="./icon.svg" alt="Teak Logo" className="h-4" />
        </a>

        <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1">
          {user?.email}
        </div>
      </div>

      {renderStatus()}

      {signOutError && (
        <p className="absolute left-1/2 top-2 w-11/12 -translate-x-1/2 rounded-lg bg-red-50 px-3 py-2 text-center text-[11px] text-red-600">
          {signOutError}
        </p>
      )}
    </div>
  );
}

export default App;
