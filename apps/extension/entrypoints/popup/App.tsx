import { MAX_FILE_SIZE } from "@teak/convex/shared/fileFormats";
import { useTranslations } from "@teak/i18n/react";
import { type ChangeEvent, type ReactNode, useEffect, useState } from "react";
import {
  ArrowUpRight,
  BookmarkCheck,
  Check,
  Info,
  LoaderCircle,
  Sparkles,
  Upload,
  type VadivamIcon,
  X,
} from "vadivam-react";
import { Button } from "../../components/ui/button";
import { Wordmark } from "../../components/Wordmark";
import { useAutoSaveUrl } from "../../hooks/useAutoSaveUrl";
import { useContextMenuSave } from "../../hooks/useContextMenuSave";
import { useExtensionSession } from "../../hooks/useExtensionSession";
import { APP_URL } from "../../lib/appUrl";
import { pendingSaveStore, storePendingSave } from "../../lib/pendingSaves";
import {
  type FileUploadState,
  getPopupStatus,
  type PopupStatus,
  type PopupTone,
  uploadPromptStatus,
} from "../../lib/popupStatus";
import { cn } from "../../lib/utils";
import { MESSAGE_TYPES, type TeakSaveResponse } from "../../types/messages";
import { SaveDetails } from "./SaveDetails";

// Firefox closes the toolbar popup as its file picker opens, and the chosen
// file with it, so there "Upload file" opens this page in a window of its own.
const UPLOAD_HASH = "#upload";
const UPLOADS_IN_WINDOW = import.meta.env.BROWSER === "firefox";
const IS_UPLOAD_WINDOW = window.location.hash === UPLOAD_HASH;
if (IS_UPLOAD_WINDOW) {
  document.body.classList.replace("w-90", "w-full");
}

const openUploadWindow = async () => {
  await chrome.windows.create({
    height: 400,
    type: "popup",
    url: chrome.runtime.getURL(`popup.html${UPLOAD_HASH}`),
    width: 400,
  });
  window.close();
};

const TONES: Record<PopupTone, { className: string; icon: VadivamIcon }> = {
  error: { className: "bg-destructive/10 text-destructive", icon: X },
  existing: {
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    icon: BookmarkCheck,
  },
  info: { className: "bg-muted text-muted-foreground", icon: Info },
  loading: {
    className: "bg-primary/10 text-primary [&>svg]:animate-spin",
    icon: LoaderCircle,
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
  const t = useTranslations("extension.popup");
  const {
    data: session,
    isPending,
    error: sessionError,
    refetch,
    hasPendingFlow,
    pendingCount,
    notice,
    privateSession,
  } = useExtensionSession();

  if (isPending) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <LoaderCircle
          aria-label={t("loading")}
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
            detail: sessionError.message || t("loadAccountFailed"),
            title: t("somethingWentWrong"),
            tone: "error",
          }}
        >
          <Button onClick={() => refetch()} size="sm" variant="outline">
            {t("tryAgain")}
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
        privateSession={privateSession}
      />
    );
  }

  return (
    <AuthenticatedPopup
      pendingCount={pendingCount}
      privateSession={privateSession}
      user={session.user}
    />
  );
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

function PrivateSessionNotice({
  className,
  show,
}: {
  className?: string;
  show: boolean;
}) {
  const t = useTranslations("extension.popup");
  return show ? (
    <p
      className={cn(
        "text-balance text-center text-muted-foreground text-xs",
        className
      )}
    >
      {t("privateSession")}
    </p>
  ) : null;
}

function PendingSavesNotice({ count }: { count: number }) {
  const t = useTranslations("extension.popup");
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
        failure instanceof Error ? failure.message : t("pendingSavesFailed")
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="w-full space-y-1.5 text-left">
      <div className="flex items-center gap-1 rounded-xl border bg-muted/50 py-1 pr-1 pl-3 text-xs">
        <span className="flex-1 text-muted-foreground">
          {t("pendingSaves", { count })}
        </span>
        <Button
          className="h-7 px-2.5 text-xs"
          disabled={busy}
          onClick={() => void act(MESSAGE_TYPES.DISCARD_PENDING)}
          size="sm"
          variant="ghost"
        >
          {t("discard")}
        </Button>
        <Button
          className="h-7 px-2.5 text-xs"
          disabled={busy}
          onClick={() => void act(MESSAGE_TYPES.RETRY_PENDING)}
          size="sm"
          variant="outline"
        >
          {t("retry")}
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
  privateSession,
}: {
  isFinishingSignIn: boolean;
  pendingCount: number;
  notice?: string;
  privateSession: boolean;
}) {
  const t = useTranslations("extension.popup");
  const [error, setError] = useState<string | null>(null);
  const handleSignIn = async () => {
    setError(null);
    try {
      const result = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SIGN_IN,
      });
      if (result?.status === "error") {
        setError(result.message || t("signInFailed"));
      }
    } catch {
      setError(t("signInFailed"));
    }
  };

  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-6 px-8 py-10 text-center">
      <Wordmark className="h-7 w-auto" title="Teak" variant="primary" />
      <div className="space-y-1.5">
        <h1 className="font-medium text-base">{t("headline")}</h1>
        <p className="text-balance text-muted-foreground">
          {t("signInPrompt")}
        </p>
      </div>
      <PendingSavesNotice count={pendingCount} />
      <PrivateSessionNotice show={privateSession} />
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
            <LoaderCircle className="animate-spin" />
            {t("finishingSignIn")}
          </>
        ) : (
          t("signIn")
        )}
      </Button>
    </div>
  );
}

function AuthenticatedPopup({
  user,
  pendingCount,
  privateSession,
}: {
  user: SessionUser;
  pendingCount: number;
  privateSession: boolean;
}) {
  const t = useTranslations("extension.popup");
  const statusStrings = useTranslations("extension.popup.status");
  const { state: contextMenuState, isRecentSave: recentMenuSave } =
    useContextMenuSave();
  const isRecentSave = recentMenuSave && !IS_UPLOAD_WINDOW;
  const autoSave = useAutoSaveUrl(!(isRecentSave || IS_UPLOAD_WINDOW));
  const [signOutLoading, setSignOutLoading] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [detailsTouched, setDetailsTouched] = useState(false);
  const [fileUpload, setFileUpload] = useState<{
    code?: string;
    error?: string;
    fileName?: string;
    state: FileUploadState;
  }>({ state: "idle" });

  const baseStatus = getPopupStatus(
    {
      autoSave: {
        code: autoSave.code,
        error: autoSave.error,
        state: autoSave.state,
        url: autoSave.currentUrl,
      },
      contextMenu: isRecentSave ? contextMenuState : undefined,
      detailsTouched,
      fileUpload,
    },
    statusStrings
  );
  const status =
    baseStatus ?? (IS_UPLOAD_WINDOW ? uploadPromptStatus(statusStrings) : null);
  const detailsCardId =
    !isRecentSave &&
    fileUpload.state === "idle" &&
    (autoSave.state === "success" || autoSave.state === "duplicate")
      ? autoSave.cardId
      : undefined;
  const autoClose = Boolean(status?.autoClose);

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
    const fail = (error: string, code?: string) =>
      setFileUpload({ code, error, fileName, state: "error" });
    setFileUpload({ fileName, state: "saving" });
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      fail(t("fileInvalid"));
      return;
    }
    let result: TeakSaveResponse;
    try {
      const id = crypto.randomUUID();
      const retainsFiles = pendingSaveStore().retainsFiles;
      if (retainsFiles) {
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
      }
      result = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SAVE_FILE,
        payload: retainsFiles ? { id } : { file, id },
      });
    } catch {
      fail(t("fileSaveFailed"));
      return;
    }
    if (result.status === "unauthenticated") {
      fail(t("reconnectForUpload"));
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
    fail(result.message, result.code);
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
      setSignOutError(t("signOutFailed"));
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
            {t("openTeak")}
            <ArrowUpRight />
          </a>
        </Button>
      </header>

      <div className="px-4">
        <PendingSavesNotice count={pendingCount} />
      </div>

      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-8 py-8">
        {status ? (
          <StatusView status={status}>
            {status.tone === "upgrade" ? (
              <Button asChild size="sm">
                <a
                  href={`${APP_URL}/settings`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {t("upgrade")}
                  <ArrowUpRight />
                </a>
              </Button>
            ) : null}
          </StatusView>
        ) : null}
        {detailsCardId ? (
          <SaveDetails
            alreadySaved={autoSave.state === "duplicate"}
            cardId={detailsCardId}
            key={detailsCardId}
            onKeepOpen={() => setDetailsTouched(true)}
            userId={user.id}
          />
        ) : null}
      </main>

      {signOutError ? (
        <p className="px-4 pb-2 text-destructive text-xs" role="alert">
          {signOutError}
        </p>
      ) : null}

      <PrivateSessionNotice className="px-6 pb-3" show={privateSession} />

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
          {t("signOut")}
        </Button>
        {UPLOADS_IN_WINDOW && !IS_UPLOAD_WINDOW ? (
          <Button
            onClick={() => {
              void openUploadWindow();
            }}
            size="sm"
            variant="outline"
          >
            <Upload />
            {t("uploadFile")}
          </Button>
        ) : (
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
              {t("uploadFile")}
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
        )}
      </footer>
    </div>
  );
}

export default App;
