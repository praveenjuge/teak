import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";
import { MAX_FILE_SIZE } from "@teak/convex/shared/file-formats";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Info,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { type ChangeEvent, useEffect, useState } from "react";
import type { DuplicateCard } from "../../hooks/useAutoSaveUrl";
import { useAutoSaveUrl } from "../../hooks/useAutoSaveUrl";
import { useContextMenuSave } from "../../hooks/useContextMenuSave";
import { useExtensionSession } from "../../hooks/useExtensionSession";
import { storePendingSave } from "../../lib/pendingSaves";
import {
  type FileUploadState,
  shouldAutoClosePopup,
} from "../../lib/popupAutoClose";
import { MESSAGE_TYPES, type TeakSaveResponse } from "../../types/messages";
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
    ? resolveTeakDevAppUrl(import.meta.env)
    : "https://app.teakvault.com";

  const handleUpgradeClick = () => {
    chrome.tabs.create({ url: `${baseUrl}/settings` });
    window.close();
  };

  return (
    <div className="flex min-h-96 w-96 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
        <AlertTriangle className="h-5 w-5 text-amber-600" />
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
        className="flex items-center gap-1.5 rounded-full bg-red-600 px-4 py-2 font-semibold text-sm text-white transition-colors hover:bg-red-700"
        onClick={handleUpgradeClick}
        type="button"
      >
        Upgrade to Pro
        <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

interface SessionUser {
  email: string;
  id: string;
  image?: string;
  name?: string;
}

function App() {
  const {
    data: session,
    isPending,
    error: sessionError,
    refetch,
    hasPendingFlow,
    pendingCount,
  } = useExtensionSession();

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
    return (
      <AuthPanel
        isFinishingSignIn={hasPendingFlow}
        pendingCount={pendingCount}
      />
    );
  }

  return <AuthenticatedPopup pendingCount={pendingCount} user={session.user} />;
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
      {/** biome-ignore lint/correctness/useImageSize: <> */}
      <img alt="Teak Logo" className="h-6" src="./icon.svg" />
      <p className="text-red-600 text-sm">{message}</p>
      <button
        className="rounded-full border border-gray-300 px-4 py-2 font-medium text-gray-700 text-sm hover:bg-gray-50"
        onClick={onRetry}
        type="button"
      >
        Try again
      </button>
    </div>
  );
}

function PendingSavesNotice({ count }: { count: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!count) {
    return null;
  }
  const act = async (
    type:
      | typeof MESSAGE_TYPES.RETRY_PENDING
      | typeof MESSAGE_TYPES.DISCARD_PENDING
  ) => {
    setBusy(true);
    setError(null);
    try {
      const result = await chrome.runtime.sendMessage({ type });
      if (result?.status === "error") {
        throw new Error(result.message);
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not update pending saves."
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1 text-gray-600 text-xs">
      <div className="flex items-center justify-center gap-3">
        <span>
          {count} pending {count === 1 ? "save" : "saves"}
        </span>
        <button
          disabled={busy}
          onClick={() => void act(MESSAGE_TYPES.RETRY_PENDING)}
          type="button"
        >
          Retry
        </button>
        <button
          disabled={busy}
          onClick={() => void act(MESSAGE_TYPES.DISCARD_PENDING)}
          type="button"
        >
          Discard
        </button>
      </div>
      {error ? (
        <p className="text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AuthPanel({
  isFinishingSignIn,
  pendingCount,
}: {
  isFinishingSignIn: boolean;
  pendingCount: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const handleSignIn = async () => {
    setError(null);
    try {
      const result = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SIGN_IN,
      });
      if (result?.status === "error") {
        setError(result.message || "Could not sign in. Please try again.");
      }
    } catch {
      setError("Could not sign in. Please try again.");
    }
  };

  return (
    <div className="flex min-h-96 w-96 flex-col items-center justify-center gap-5 p-6 text-center">
      <div className="flex flex-col items-center space-y-3">
        {/** biome-ignore lint/correctness/useImageSize: <> */}
        <img alt="Teak Logo" className="h-5" src="./icon.svg" />
        <h1 className="font-semibold text-base">Save Anything. Anywhere.</h1>
      </div>

      <PendingSavesNotice count={pendingCount} />
      {error ? (
        <p className="text-red-600 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="w-full space-y-3">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-full bg-red-600 px-4 py-2.5 font-semibold text-sm text-white hover:bg-red-700"
          disabled={isFinishingSignIn}
          onClick={() => {
            void handleSignIn();
          }}
          type="button"
        >
          Sign in
        </button>

        {isFinishingSignIn && (
          <p className="flex items-center justify-center gap-2 text-gray-500 text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            Finishing sign-in…
          </p>
        )}
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

    if (diffInDays === 0) {
      return "today";
    }
    if (diffInDays === 1) {
      return "yesterday";
    }
    if (diffInDays < 7) {
      return `${diffInDays} days ago`;
    }
    if (diffInDays < 30) {
      return `${Math.floor(diffInDays / 7)} weeks ago`;
    }
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

function AuthenticatedPopup({
  user,
  pendingCount,
}: {
  user: SessionUser;
  pendingCount: number;
}) {
  const { state: contextMenuState, isRecentSave } = useContextMenuSave();
  const { state, error, duplicateCard } = useAutoSaveUrl(!isRecentSave);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [fileUploadState, setFileUploadState] =
    useState<FileUploadState>("idle");
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);

  // Auto-close popup after successful save
  useEffect(() => {
    const isAutoSaveSuccess = state === "success";
    const isContextMenuSuccess =
      isRecentSave && contextMenuState.status === "success";

    if (
      shouldAutoClosePopup({
        fileUploadState,
        isAutoSaveSuccess,
        isContextMenuSuccess,
      })
    ) {
      const timer = setTimeout(() => {
        window.close();
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [state, isRecentSave, contextMenuState.status, fileUploadState]);

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setFileUploadError(null);
    setFileUploadState("saving");
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      setFileUploadError("File is empty or too large.");
      setFileUploadState("error");
      return;
    }
    let result: TeakSaveResponse;
    try {
      const id = crypto.randomUUID();
      await storePendingSave({
        ownerId: user.id,
        id,
        createdAt: Date.now(),
        kind: "file",
        input: {
          bytes: file,
          fileName: file.name,
          mimeType: file.type,
          source: "popup-file",
        },
      });
      result = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SAVE_FILE,
        payload: { id },
      });
    } catch {
      setFileUploadError("Could not save the file. Please try again.");
      setFileUploadState("error");
      return;
    }
    if (result.status === "unauthenticated") {
      setFileUploadError("Reconnect to finish your pending upload.");
      setFileUploadState("error");
      return;
    }
    if (result.status === "saved") {
      setFileUploadState("success");
      return;
    }
    setFileUploadError(
      result.status === "error" ? result.message : "File is already saved."
    );
    setFileUploadState("error");
  };

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
        case "save-asset":
          return "Asset saved!";
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
            <Check className="h-4 w-4 text-green-500" strokeWidth={3} />
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
              <X className="h-4 w-4 text-red-600" />
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
    if (fileUploadState === "saving") {
      return (
        <div className="flex min-h-96 w-96 items-center justify-center gap-2 p-3">
          <Loader2 className="h-4 w-4 animate-spin text-red-600" />
          <span className="text-red-700 text-sm">Uploading file...</span>
        </div>
      );
    }
    if (fileUploadState === "success") {
      return (
        <div className="flex min-h-96 w-96 items-center justify-center gap-2 p-3">
          <Check className="h-4 w-4 text-green-500" strokeWidth={3} />
          <span className="text-green-700 text-sm">File saved!</span>
        </div>
      );
    }
    if (fileUploadState === "error") {
      return (
        <div className="flex min-h-96 w-96 flex-col items-center justify-center gap-2 p-4 text-center">
          <X className="h-4 w-4 text-red-600" />
          <span className="text-red-700 text-sm">{fileUploadError}</span>
        </div>
      );
    }

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
            <Check className="h-4 w-4 text-green-500" strokeWidth={3} />
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
              <X className="h-4 w-4 text-red-600" />
              <span className="text-red-700 text-sm">Failed to save</span>
            </div>
            {error && <span className="text-red-600 text-xs">{error}</span>}
          </div>
        );
      case "invalid-url":
        return (
          <div className="flex min-h-96 w-96 items-center justify-center gap-2 p-3">
            <Info className="h-4 w-4 text-gray-500" />
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
      <div className="absolute inset-x-3 top-3">
        <PendingSavesNotice count={pendingCount} />
      </div>
      <div className="absolute right-0 bottom-0 left-0 flex items-center justify-between gap-2 p-3">
        <a
          href="https://app.teakvault.com"
          rel="noopener noreferrer"
          target="_blank"
          title="Open Teak"
        >
          {/** biome-ignore lint/correctness/useImageSize: <> */}
          <img alt="Teak Logo" className="h-4" src="./icon.svg" />
        </a>

        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-gray-700 text-xs hover:bg-gray-50">
            <Upload className="h-3 w-3" />
            Upload file
            <input
              className="sr-only"
              disabled={fileUploadState === "saving"}
              onChange={(event) => {
                void handleFileSelected(event);
              }}
              type="file"
            />
          </label>
          <button
            className="text-gray-600 text-xs"
            disabled={signOutLoading}
            onClick={async () => {
              setSignOutLoading(true);
              setSignOutError(null);
              try {
                const result = await chrome.runtime.sendMessage({
                  type: MESSAGE_TYPES.SIGN_OUT,
                });
                if (result?.status === "error") {
                  throw new Error(result.message);
                }
              } catch {
                setSignOutError("Could not sign out. Please try again.");
              } finally {
                setSignOutLoading(false);
              }
            }}
            type="button"
          >
            Sign out
          </button>
          <div className="max-w-36 truncate rounded-full bg-gray-100 px-3 py-1">
            {user?.email}
          </div>
        </div>
      </div>

      {renderStatus()}

      {signOutError && (
        <p className="absolute top-2 left-1/2 w-11/12 -translate-x-1/2 rounded-xl bg-red-50 px-3 py-2 text-center text-[11px] text-red-600">
          {signOutError}
        </p>
      )}
    </div>
  );
}

export default App;
