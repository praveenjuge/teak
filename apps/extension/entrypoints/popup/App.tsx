import { resolveTeakDevAppUrl } from "@teak/convex/dev-urls";
import { MAX_FILE_SIZE } from "@teak/convex/shared/file-formats";
import { Button } from "@teak/ui/components/ui/button";
import { Wordmark } from "@teak/ui/logo";
import {
  ArrowUpRight,
  BookmarkCheck,
  Check,
  Info,
  Loader2,
  type LucideIcon,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { type ChangeEvent, type ReactNode, useEffect, useState } from "react";
import { useAutoSaveUrl } from "../../hooks/useAutoSaveUrl";
import { useContextMenuSave } from "../../hooks/useContextMenuSave";
import { useExtensionSession } from "../../hooks/useExtensionSession";
import { storePendingSave } from "../../lib/pendingSaves";
import {
  type FileUploadState,
  getPopupStatus,
  type PopupStatus,
  type PopupTone,
} from "../../lib/popupStatus";
import { MESSAGE_TYPES, type TeakSaveResponse } from "../../types/messages";

const APP_URL = import.meta.env.DEV
  ? resolveTeakDevAppUrl(import.meta.env)
  : "https://app.teakvault.com";

const TONES: Record<PopupTone, { className: string; icon: LucideIcon }> = {
  error: { className: "bg-destructive/10 text-destructive", icon: X },
  existing: {
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    icon: BookmarkCheck,
  },
  info: { className: "bg-muted text-muted-foreground", icon: Info },
  loading: {
    className: "bg-primary/10 text-primary [&>svg]:animate-spin",
    icon: Loader2,
  },
  success: {
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    icon: Check,
  },
  upgrade: {
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    icon: Sparkles,
  },
};

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
    notice,
  } = useExtensionSession();

  if (isPending) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Loader2
          aria-label="Loading"
          className="size-5 animate-spin text-primary"
        />
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center px-8">
        <StatusView
          status={{
            autoClose: false,
            detail: sessionError.message || "We couldn't load your account.",
            title: "Something went wrong",
            tone: "error",
          }}
        >
          <Button onClick={() => refetch()} size="sm" variant="outline">
            Try again
          </Button>
        </StatusView>
      </div>
    );
  }

  if (!session) {
    return (
      <AuthPanel
        isFinishingSignIn={hasPendingFlow}
        notice={notice}
        pendingCount={pendingCount}
      />
    );
  }

  return <AuthenticatedPopup pendingCount={pendingCount} user={session.user} />;
}

function StatusView({
  status,
  children,
}: {
  status: PopupStatus;
  children?: ReactNode;
}) {
  const { className, icon: Icon } = TONES[status.tone];
  return (
    <div
      aria-live="polite"
      className="flex flex-col items-center gap-3 text-center"
      role="status"
    >
      <div
        className={`flex size-12 items-center justify-center rounded-full ${className}`}
      >
        <Icon aria-hidden="true" className="size-5" strokeWidth={2.5} />
      </div>
      <div className="space-y-1">
        <p className="font-medium text-base">{status.title}</p>
        {status.detail ? (
          <p className="line-clamp-3 max-w-64 text-balance break-words text-muted-foreground">
            {status.detail}
          </p>
        ) : null}
      </div>
      {children}
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
    <div className="w-full space-y-1.5 text-left">
      <div className="flex items-center gap-1 rounded-xl border bg-muted/50 py-1 pr-1 pl-3 text-xs">
        <span className="flex-1 text-muted-foreground">
          {count} {count === 1 ? "save" : "saves"} didn&apos;t finish
        </span>
        <Button
          className="h-7 px-2.5 text-xs"
          disabled={busy}
          onClick={() => void act(MESSAGE_TYPES.DISCARD_PENDING)}
          size="sm"
          variant="ghost"
        >
          Discard
        </Button>
        <Button
          className="h-7 px-2.5 text-xs"
          disabled={busy}
          onClick={() => void act(MESSAGE_TYPES.RETRY_PENDING)}
          size="sm"
          variant="outline"
        >
          Retry
        </Button>
      </div>
      {error ? (
        <p className="px-1 text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function AuthPanel({
  isFinishingSignIn,
  pendingCount,
  notice,
}: {
  isFinishingSignIn: boolean;
  pendingCount: number;
  notice?: string;
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
    <div className="flex min-h-80 flex-col items-center justify-center gap-6 px-8 py-10 text-center">
      <Wordmark className="h-7 w-auto" title="Teak" variant="primary" />
      <div className="space-y-1.5">
        <h1 className="font-medium text-base">Save anything, anywhere</h1>
        <p className="text-balance text-muted-foreground">
          Sign in to save pages, images, and text to your Teak.
        </p>
      </div>
      <PendingSavesNotice count={pendingCount} />
      {notice ? (
        <p className="text-muted-foreground" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        className="w-full"
        disabled={isFinishingSignIn}
        onClick={() => {
          void handleSignIn();
        }}
        size="lg"
      >
        {isFinishingSignIn ? (
          <>
            <Loader2 className="animate-spin" />
            Finishing sign-in…
          </>
        ) : (
          "Sign in"
        )}
      </Button>
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
  const autoSave = useAutoSaveUrl(!isRecentSave);
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [fileUpload, setFileUpload] = useState<{
    error?: string;
    fileName?: string;
    state: FileUploadState;
  }>({ state: "idle" });

  const status = getPopupStatus({
    autoSave: {
      error: autoSave.error,
      state: autoSave.state,
      url: autoSave.currentUrl,
    },
    contextMenu: isRecentSave ? contextMenuState : undefined,
    fileUpload,
  });
  const autoClose = Boolean(status?.autoClose);

  // Close shortly after a save finishes so the user can keep browsing.
  useEffect(() => {
    if (!autoClose) {
      return;
    }
    const timer = setTimeout(() => window.close(), 2000);
    return () => clearTimeout(timer);
  }, [autoClose]);

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    const fileName = file.name;
    const fail = (error: string) =>
      setFileUpload({ error, fileName, state: "error" });
    setFileUpload({ fileName, state: "saving" });
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      fail("File is empty or too large.");
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
          fileName,
          mimeType: file.type,
          source: "popup-file",
        },
      });
      result = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SAVE_FILE,
        payload: { id },
      });
    } catch {
      fail("Could not save the file. Please try again.");
      return;
    }
    if (result.status === "unauthenticated") {
      fail("Reconnect to finish your pending upload.");
      return;
    }
    if (result.status === "saved") {
      setFileUpload({ fileName, state: "success" });
      return;
    }
    if (result.status === "duplicate") {
      setFileUpload({ fileName, state: "duplicate" });
      return;
    }
    fail(result.message);
  };

  const handleSignOut = async () => {
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
  };

  const isUploading = fileUpload.state === "saving";

  return (
    <div className="flex min-h-80 flex-col">
      <header className="flex items-center justify-between py-3 pr-2 pl-4">
        <a href={APP_URL} rel="noopener noreferrer" target="_blank">
          <Wordmark className="h-5 w-auto" title="Teak" variant="primary" />
        </a>
        <Button asChild size="sm" variant="ghost">
          <a href={APP_URL} rel="noopener noreferrer" target="_blank">
            Open Teak
            <ArrowUpRight />
          </a>
        </Button>
      </header>

      <div className="px-4">
        <PendingSavesNotice count={pendingCount} />
      </div>

      <main className="flex flex-1 flex-col items-center justify-center px-8 py-8">
        {status ? (
          <StatusView status={status}>
            {status.tone === "upgrade" ? (
              <Button asChild size="sm">
                <a
                  href={`${APP_URL}/settings`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Upgrade to Pro
                  <ArrowUpRight />
                </a>
              </Button>
            ) : null}
          </StatusView>
        ) : null}
      </main>

      {signOutError ? (
        <p className="px-4 pb-2 text-destructive text-xs" role="alert">
          {signOutError}
        </p>
      ) : null}

      <footer className="flex items-center gap-1 border-t py-2 pr-2 pl-4">
        <span
          className="min-w-0 flex-1 truncate text-muted-foreground text-xs"
          title={user.email}
        >
          {user.email}
        </span>
        <Button
          disabled={signOutLoading}
          onClick={() => {
            void handleSignOut();
          }}
          size="sm"
          variant="ghost"
        >
          Sign out
        </Button>
        <Button
          aria-disabled={isUploading}
          asChild
          className={
            isUploading ? "pointer-events-none opacity-50" : "cursor-pointer"
          }
          size="sm"
          variant="outline"
        >
          <label>
            <Upload />
            Upload file
            <input
              className="sr-only"
              disabled={isUploading}
              onChange={(event) => {
                void handleFileSelected(event);
              }}
              type="file"
            />
          </label>
        </Button>
      </footer>
    </div>
  );
}

export default App;
