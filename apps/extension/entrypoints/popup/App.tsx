import { MAX_FILE_SIZE } from "@teak/convex/shared/fileFormats";
import { useTranslations } from "@teak/i18n/react";
import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { ArrowUpRight, LoaderCircle, LogOut, Upload } from "vadivam-react";
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
  previewItem,
  type SavedItem,
  uploadPromptStatus,
} from "../../lib/popupStatus";
import { cn } from "../../lib/utils";
import { MESSAGE_TYPES, type TeakSaveResponse } from "../../types/messages";
import { AccountMenu, menuItemClass, type SessionUser } from "./AccountMenu";
import { DetailsPlaceholder, SaveDetails } from "./SaveDetails";
import { SavedItemCard, StatusLine } from "./SavedItem";
import { TONES } from "./tones";

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
  const { chip, icon: Icon } = TONES[status.tone];
  return (
    <div
      aria-live="polite"
      className="flex flex-col items-center gap-4 text-center"
      role="status"
    >
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-full ring-8",
          chip
        )}
      >
        <Icon aria-hidden="true" className="size-5" strokeWidth={2.5} />
      </div>
      <div className="space-y-1">
        <p className="font-semibold text-base tracking-tight">{status.title}</p>
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
      <Wordmark className="h-6 w-auto" title="Teak" variant="primary" />
      <div className="space-y-1.5">
        <h1 className="font-semibold text-lg tracking-tight">
          {t("headline")}
        </h1>
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
  const [chosenFile, setChosenFile] = useState<SavedItem>();
  const fileInput = useRef<HTMLInputElement>(null);

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
  const item = previewItem({
    autoSave: {
      state: autoSave.state,
      tab: autoSave.currentTab,
      url: autoSave.currentUrl,
    },
    chosenFile,
    fileState: fileUpload.state,
    isRecentSave,
    status,
  });

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
    setChosenFile({
      kind: "file",
      mimeType: file.type,
      name: fileName,
      size: file.size,
    });
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
  const chooseFile = () => {
    if (isUploading) {
      return;
    }
    if (UPLOADS_IN_WINDOW && !IS_UPLOAD_WINDOW) {
      void openUploadWindow();
      return;
    }
    fileInput.current?.click();
  };

  return (
    <div className="flex min-h-80 flex-col">
      <header className="flex items-center justify-between py-2.5 pr-2.5 pl-4">
        <a href={APP_URL} rel="noopener noreferrer" target="_blank">
          <Wordmark className="h-5 w-auto" title="Teak" variant="primary" />
        </a>
        <AccountMenu label={t("menu")} user={user}>
          <a
            className={menuItemClass}
            href={APP_URL}
            rel="noopener noreferrer"
            role="menuitem"
            target="_blank"
          >
            <ArrowUpRight aria-hidden="true" />
            {t("openTeak")}
          </a>
          <button
            aria-disabled={isUploading || undefined}
            className={menuItemClass}
            onClick={chooseFile}
            role="menuitem"
            type="button"
          >
            <Upload aria-hidden="true" />
            {t("uploadFile")}
          </button>
          <hr className="-mx-1 my-1 border-border" />
          <button
            aria-disabled={signOutLoading || undefined}
            className={menuItemClass}
            onClick={() => {
              if (!signOutLoading) {
                void handleSignOut();
              }
            }}
            role="menuitem"
            type="button"
          >
            <LogOut aria-hidden="true" />
            {t("signOut")}
          </button>
        </AccountMenu>
      </header>

      <div className="px-4">
        <PendingSavesNotice count={pendingCount} />
      </div>

      <main
        className={
          item
            ? "flex flex-1 flex-col justify-center gap-3 px-4 pt-1 pb-5"
            : "flex flex-1 flex-col items-center justify-center gap-5 px-8 py-8"
        }
      >
        {item && status ? (
          <>
            <StatusLine status={status} />
            <SavedItemCard busy={status.tone === "loading"} item={item}>
              {detailsCardId ? (
                <SaveDetails
                  alreadySaved={autoSave.state === "duplicate"}
                  cardId={detailsCardId}
                  key={detailsCardId}
                  onKeepOpen={() => setDetailsTouched(true)}
                  userId={user.id}
                />
              ) : null}
              {item.kind === "page" && status.tone === "loading" ? (
                <DetailsPlaceholder />
              ) : null}
            </SavedItemCard>
          </>
        ) : null}
        {status && !item ? (
          <StatusView status={status}>
            {status.tone === "upgrade" ? (
              <Button asChild size="sm">
                <a
                  href={`${APP_URL}/settings/plan`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {t("upgrade")}
                  <ArrowUpRight />
                </a>
              </Button>
            ) : null}
            {IS_UPLOAD_WINDOW && fileUpload.state === "idle" ? (
              <Button onClick={chooseFile} size="sm">
                <Upload />
                {t("uploadFile")}
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

      <PrivateSessionNotice className="px-6 pb-3" show={privateSession} />

      {/* Outside the menu, so closing the menu doesn't drop the chosen file. */}
      <input
        className="sr-only"
        disabled={isUploading}
        onChange={(event) => {
          void handleFileSelected(event);
        }}
        ref={fileInput}
        tabIndex={-1}
        type="file"
      />
    </div>
  );
}

export default App;
