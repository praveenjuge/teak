import { ArrowRight, Info, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { DuplicateCard } from "../../hooks/useAutoSaveUrl";
import { useAutoSaveUrl } from "../../hooks/useAutoSaveUrl";
import { useContextMenuSave } from "../../hooks/useContextMenuSave";
import { useWebAppSession } from "../../hooks/useWebAppSession";
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
    <div className="flex min-h-96 w-96 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
        <svg
          className="h-5 w-5 text-amber-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
          />
        </svg>
      </div>
      <div className="space-y-1">
        <p className="font-medium text-gray-900 text-sm">
          You&apos;ve reached your free tier limit.
        </p>
        <p className="text-gray-600 text-xs">
          Upgrade to Pro for unlimited cards.
        </p>
      </div>
      <button
        className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 font-semibold text-sm text-white transition-colors hover:bg-red-700"
        onClick={handleUpgradeClick}
        type="button"
      >
        Upgrade to Pro
        <ArrowRight className="h-4 w-4" />
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
      <div className="flex min-h-96 w-96 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-red-600" />
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
    <div className="flex min-h-96 w-96 flex-col items-center justify-center gap-4 p-5 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt="Teak Logo" className="h-6" src="./icon.svg" />
      <p className="text-red-600 text-sm">{message}</p>
      <button
        className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 text-sm hover:bg-gray-50"
        onClick={onRetry}
        type="button"
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
    <div className="flex min-h-96 w-96 flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="flex flex-col items-center space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="Teak Logo" className="h-5" src="./icon.svg" />
        <h1 className="font-semibold text-base">Save Anything. Anywhere.</h1>
      </div>

      <div className="w-full space-y-3">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-sm text-white hover:bg-red-700"
          onClick={handleLogin}
          type="button"
        >
          Login
        </button>

        <button
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 font-semibold text-gray-700 text-sm hover:bg-gray-50"
          onClick={handleRegister}
          type="button"
        >
          Create Account
        </button>
      </div>
    </div>
  );
}

function DuplicateState({
  duplicateCard,
}: {
  duplicateCard?: DuplicateCard | null;
}) {
  const _formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffInDays === 0) return "today";
    if (diffInDays === 1) return "yesterday";
    if (diffInDays < 7) return `${diffInDays} days ago`;
    if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
    return date.toLocaleDateString();
  };

  const cardTitle =
    duplicateCard?.metadataTitle || duplicateCard?.content || "This page";
  const _truncatedTitle =
    cardTitle.length > 50 ? `${cardTitle.slice(0, 50)}...` : cardTitle;

  return (
    <div className="flex min-h-96 w-96 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
        <Info className="h-4 w-4 text-gray-600" />
      </div>

      <p className="font-medium text-gray-900 text-sm">
        You have already saved this!
      </p>
    </div>
  );
}

function AuthenticatedPopup({ user }: { user: SessionUser }) {
  const { state: contextMenuState, isRecentSave } = useContextMenuSave();
  const { state, error, duplicateCard } = useAutoSaveUrl(!isRecentSave);
  const [_signOutLoading, _setSignOutLoading] = useState(false);
  const [signOutError, _setSignOutError] = useState<string | null>(null);

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
          <div className="flex min-h-96 w-96 items-center justify-center gap-2 p-3">
            <Loader2 className="h-4 w-4 animate-spin text-red-600" />
            <span className="text-red-700 text-sm">Saving to Teak...</span>
          </div>
        );
      case "success":
        return (
          <div className="flex min-h-96 w-96 items-center justify-center gap-2 p-3">
            <svg
              className="h-4 w-4 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M5 13l4 4L19 7"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
              />
            </svg>
            <span className="text-green-700 text-sm">
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
          <div className="flex min-h-96 w-96 flex-col items-center justify-center gap-1 p-3">
            <div className="flex items-center justify-center gap-2">
              <svg
                className="h-4 w-4 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M6 18L18 6M6 6l12 12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                />
              </svg>
              <span className="text-red-700 text-sm">Failed to save</span>
            </div>
            {contextMenuState.error && (
              <span className="text-red-600 text-xs">
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
          <div className="flex min-h-96 w-96 items-center justify-center gap-2 p-3">
            <Loader2 className="h-4 w-4 animate-spin text-red-600" />
            <span className="text-red-700 text-sm">Adding to Teak...</span>
          </div>
        );
      case "success":
        return (
          <div className="flex min-h-96 w-96 items-center justify-center gap-2 p-3">
            <svg
              className="h-4 w-4 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M5 13l4 4L19 7"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
              />
            </svg>
            <span className="text-green-700 text-sm">Added to Teak!</span>
          </div>
        );
      case "error":
        // Show upgrade prompt for card limit errors
        if (isCardLimitError(error)) {
          return <UpgradePrompt />;
        }
        return (
          <div className="flex min-h-96 w-96 flex-col items-center justify-center gap-1 p-3">
            <div className="flex items-center justify-center gap-2">
              <svg
                className="h-4 w-4 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M6 18L18 6M6 6l12 12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                />
              </svg>
              <span className="text-red-700 text-sm">Failed to save</span>
            </div>
            {error && <span className="text-red-600 text-xs">{error}</span>}
          </div>
        );
      case "invalid-url":
        return (
          <div className="flex min-h-96 w-96 items-center justify-center gap-2 p-3">
            <svg
              className="h-4 w-4 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
            <span className="text-gray-700 text-sm">
              Can&apos;t save this page
            </span>
          </div>
        );
      case "duplicate":
        return <DuplicateState duplicateCard={duplicateCard} />;
      default:
        return null;
    }
  };

  return (
    <div className="relative min-h-96 w-96">
      <div className="absolute right-0 bottom-0 left-0 flex items-center justify-between gap-2 p-3">
        <a
          href="https://app.teakvault.com"
          rel="noopener noreferrer"
          target="_blank"
          title="Open Teak"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="Teak Logo" className="h-4" src="./icon.svg" />
        </a>

        <div className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1">
          {user?.email}
        </div>
      </div>

      {renderStatus()}

      {signOutError && (
        <p className="absolute top-2 left-1/2 w-11/12 -translate-x-1/2 rounded-lg bg-red-50 px-3 py-2 text-center text-[11px] text-red-600">
          {signOutError}
        </p>
      )}
    </div>
  );
}

export default App;
