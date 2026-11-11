import { captureEvent } from "@teak/convex/shared/analytics";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { useTranslations } from "@teak/i18n/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Download, Mic, PenLine, Plus, Square, Upload } from "vadivam-react";
import { useGlobalFileDrop } from "@/components/providers/GlobalFileDropProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useCanCreateCard } from "@/hooks/useCanCreateCard";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useUpgradeAction } from "@/hooks/useUpgradeAction";
import { formatClockTime } from "@/lib/clockTime";
import { runMenuItemShortcut } from "@/lib/menuShortcuts";
import { uploadAcceptAttribute } from "@/lib/upload/fileDrop";
import { cn } from "@/lib/utils";
import { useRunAfterClose } from "../../hooks/useRunAfterClose";
import { appActionKeys } from "../../lib/appCommands";
import { useLibraryCommand } from "../providers/LibraryCommandsProvider";
import { ComposerProvider } from "./ComposerProvider";

interface AddCardProviderProps {
  children: ReactNode;
  onNewNote?: () => void;
  onSuccess?: () => void;
}

const NEW_MENU_TRIGGER_CLASS = "data-[state=open]:bg-sidebar-accent";

export function NewMenuPlaceholder() {
  const t = useTranslations("forms.addCardActions");
  return (
    <SidebarMenuItem>
      <SidebarMenuButton disabled type="button">
        <Plus />
        <span>{t("new")}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NewMenuTrigger() {
  const t = useTranslations("forms.addCardActions");
  return (
    <SidebarMenuItem>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          className={NEW_MENU_TRIGGER_CLASS}
          tooltip={t("new")}
          type="button"
        >
          <Plus />
          <span>{t("new")}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
    </SidebarMenuItem>
  );
}

interface AudioRecordingFormat {
  extension: string;
  mimeType: string;
}

// Chrome and Safari expose different MediaRecorder containers: Chromium
// records WebM/Opus while Safari only records MP4/AAC. Pick the first
// supported type so recordings save as audio cards on every browser.
const AUDIO_RECORDING_CANDIDATES: readonly AudioRecordingFormat[] = [
  { extension: "webm", mimeType: "audio/webm;codecs=opus" },
  { extension: "m4a", mimeType: "audio/mp4" },
];

const selectAudioRecordingFormat = (): AudioRecordingFormat => {
  if (typeof MediaRecorder !== "undefined") {
    const supported = AUDIO_RECORDING_CANDIDATES.find((candidate) =>
      MediaRecorder.isTypeSupported(candidate.mimeType)
    );
    if (supported) {
      return supported;
    }
  }
  return AUDIO_RECORDING_CANDIDATES[0];
};

interface AddCardControls {
  canStartRecording: boolean;
  isUploading: boolean;
  newNote?: () => void;
  recordAudio: () => void;
  uploadFiles: () => void;
}

const AddCardContext = createContext<AddCardControls | null>(null);

/**
 * Owns uploading and recording, the U and R shortcuts, and the composer's
 * draft (ComposerProvider) for everything inside it. The app shell mounts it
 * once so they work while the phone's menu, which holds the New button, is
 * closed, and so a draft or a paste outlives the page it started on.
 */
export function AddCardProvider({
  children,
  onNewNote,
  onSuccess,
}: AddCardProviderProps) {
  const t = useTranslations("forms.addCardActions");
  const tLimits = useTranslations("forms.limits");
  const tc = useTranslations("common");
  const [isRecordingDialogOpen, setIsRecordingDialogOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The recording until it's saved, so it can be downloaded meanwhile (a
  // save can wait a long time offline) and saved again if it fails. `error`
  // is null while the save runs.
  const [unsaved, setUnsaved] = useState<{
    blob: Blob;
    error: string | null;
    extension: string;
  } | null>(null);

  const canCreateCard = useCanCreateCard() ?? true;
  const globalFileDrop = useGlobalFileDrop();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Counts recording starts; closing the dialog while the microphone prompt
  // is open moves it on, so the start that was waiting is dropped.
  const startAttemptRef = useRef(0);

  const { uploadFile } = useFileUpload();

  const { showCreateFailure, showUpgradeToast } = useUpgradeAction();

  const clearRecordingResources = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  useEffect(() => clearRecordingResources, [clearRecordingResources]);

  const autoSaveAudio = useCallback(
    async (blob: Blob, extension: string) => {
      const toastId = toast.loading(t("savingRecording"));
      // A failed save shows again even if the dialog was closed meanwhile.
      const keep = (error: string) => {
        setUnsaved({ blob, error, extension });
        setIsRecordingDialogOpen(true);
      };

      try {
        setIsSubmitting(true);
        setUnsaved({ blob, error: null, extension });

        const file = new File([blob], `recording_${Date.now()}.${extension}`, {
          type: blob.type,
        });

        captureEvent("card_create_submitted", {
          card_type: "audio",
          source: "web",
          via: "recording",
        });

        const result = await uploadFile(file, {
          content: "",
          additionalMetadata: {
            recordingTimestamp: Date.now(),
          },
        });

        if (result.success) {
          setUnsaved(null);
          setRecordingTime(0);
          setIsRecordingDialogOpen(false);
          onSuccess?.();
          toast.success(t("recordingSaved"), { id: toastId });
          return;
        }

        const limit = showCreateFailure(result, { id: toastId });
        if (limit) {
          keep(
            tLimits(limit === "cardLimit" ? "cardLimitReached" : "rateLimited")
          );
          return;
        }

        // The dialog stays open with the recording and says it wasn't saved.
        toast.dismiss(toastId);
        keep(t("recordingNotSaved"));
      } catch (error) {
        toast.dismiss(toastId);
        keep(t("recordingNotSaved"));
        captureClientException(error, { "ui.action": "save-recording" });
      } finally {
        setIsSubmitting(false);
      }
    },
    [onSuccess, showCreateFailure, t, tLimits, uploadFile]
  );

  const startRecording = useCallback(async () => {
    if (!canCreateCard) {
      showUpgradeToast();
      return;
    }

    startAttemptRef.current += 1;
    const attempt = startAttemptRef.current;
    setIsRecordingDialogOpen(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error(t("microphoneUnsupported"));
        setIsRecordingDialogOpen(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attempt !== startAttemptRef.current) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }
      streamRef.current = stream;
      const recordingFormat = selectAudioRecordingFormat();
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: recordingFormat.mimeType,
      });
      const chunks: Blob[] = [];

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, {
          type: mediaRecorder.mimeType || recordingFormat.mimeType,
        });
        clearRecordingResources();
        void autoSaveAudio(blob, recordingFormat.extension);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (error) {
      if (attempt !== startAttemptRef.current) {
        return;
      }
      clearRecordingResources();
      setIsRecording(false);
      setIsRecordingDialogOpen(false);

      if (error instanceof DOMException && error.name === "NotAllowedError") {
        toast.error(t("microphoneDenied"));
        return;
      }

      if (error instanceof DOMException && error.name === "NotFoundError") {
        toast.error(t("microphoneMissing"));
        return;
      }

      toast.error(t("recordingStartFailed"));
    }
  }, [
    autoSaveAudio,
    canCreateCard,
    clearRecordingResources,
    showUpgradeToast,
    t,
  ]);

  const stopRecording = useCallback(() => {
    if (!(mediaRecorderRef.current && isRecording)) {
      return;
    }

    mediaRecorderRef.current.stop();
    mediaRecorderRef.current = null;
    setIsRecording(false);
    // The dialog stays open, saying "Saving recording…", until it's saved.
    setIsSubmitting(true);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [isRecording]);

  const discardRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
      mediaRecorderRef.current = null;
    }
    clearRecordingResources();
    setIsRecording(false);
    setUnsaved(null);
    setRecordingTime(0);
    setIsRecordingDialogOpen(false);
  }, [clearRecordingResources]);

  const downloadUnsaved = () => {
    if (!unsaved) {
      return;
    }
    const url = URL.createObjectURL(unsaved.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `recording_${Date.now()}.${unsaved.extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (open) {
      setIsRecordingDialogOpen(true);
      return;
    }
    // A save under way carries on with the dialog closed; it reopens if the
    // save fails.
    if (isSubmitting) {
      setIsRecordingDialogOpen(false);
      return;
    }
    if (isRecording || unsaved) {
      discardRecording();
      return;
    }
    startAttemptRef.current += 1;
    setIsRecordingDialogOpen(false);
  };

  const handleFileUpload = () => {
    if (!canCreateCard) {
      showUpgradeToast();
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = uploadAcceptAttribute();
    input.multiple = true;
    input.style.display = "none";
    // Cancelling the picker fires `cancel`, not `change`.
    input.addEventListener("cancel", () => input.remove(), { once: true });

    input.onchange = (event) => {
      const files = Array.from((event.target as HTMLInputElement).files || []);
      input.remove();
      // Picked files upload like dropped ones, through the one upload queue.
      if (files.length > 0) {
        globalFileDrop?.enqueueFiles(files);
      }
    };

    document.body.appendChild(input);
    input.click();
  };

  let recordingStatusDescription = t("startingMicrophone");
  if (unsaved?.error && !isSubmitting) {
    recordingStatusDescription = unsaved.error;
  } else if (isSubmitting) {
    recordingStatusDescription = t("savingRecordingStatus");
  } else if (isRecording) {
    recordingStatusDescription = t("recordingHint");
  }

  const uploadRef = useRef(handleFileUpload);
  uploadRef.current = handleFileUpload;
  const isUploading = globalFileDrop?.isUploading ?? false;
  useLibraryCommand("uploadFiles", () => {
    if (isUploading) {
      return false;
    }
    uploadRef.current();
    return true;
  });
  const recordRef = useRef(startRecording);
  recordRef.current = startRecording;
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  // A recording still waiting to be saved reopens its dialog instead of
  // starting another: closing the dialog mustn't hide it for good.
  const canStartRecording = !(isRecording || (isSubmitting && !unsaved));
  const recordAudio = useCallback(() => {
    if (unsavedRef.current) {
      setIsRecordingDialogOpen(true);
      return;
    }
    recordRef.current().catch(() => undefined);
  }, []);
  useLibraryCommand("recordAudio", () => {
    if (!canStartRecording) {
      return false;
    }
    recordAudio();
    return true;
  });
  const uploadFiles = useCallback(() => uploadRef.current(), []);
  const controls = useMemo<AddCardControls>(
    () => ({
      canStartRecording,
      isUploading,
      newNote: onNewNote,
      recordAudio,
      uploadFiles,
    }),
    [canStartRecording, isUploading, onNewNote, recordAudio, uploadFiles]
  );

  return (
    <AddCardContext.Provider value={controls}>
      <ComposerProvider>{children}</ComposerProvider>

      <Dialog
        onOpenChange={handleDialogOpenChange}
        open={isRecordingDialogOpen}
      >
        <DialogContent
          className="max-w-sm text-center"
          onInteractOutside={(event) => {
            if (isRecording || isSubmitting || unsaved) {
              event.preventDefault();
            }
          }}
          showCloseButton={false}
        >
          <DialogTitle>{t("recordingTitle")}</DialogTitle>
          <DialogDescription aria-live="polite">
            {recordingStatusDescription}
          </DialogDescription>
          <div className="flex flex-col items-center gap-4 py-3">
            <div className="font-mono text-2xl text-primary tabular-nums">
              {formatClockTime(recordingTime)}
            </div>
            {unsaved ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  disabled={isSubmitting}
                  onClick={discardRecording}
                  type="button"
                  variant="outline"
                >
                  {t("discardRecording")}
                </Button>
                <Button
                  onClick={downloadUnsaved}
                  type="button"
                  variant="outline"
                >
                  <Download />
                  {t("downloadRecording")}
                </Button>
                <Button
                  disabled={isSubmitting}
                  onClick={() =>
                    void autoSaveAudio(unsaved.blob, unsaved.extension)
                  }
                  type="button"
                >
                  {tc("tryAgain")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  disabled={!isRecording || isSubmitting}
                  onClick={discardRecording}
                  type="button"
                  variant="outline"
                >
                  {t("discardRecording")}
                </Button>
                <Button
                  disabled={!isRecording || isSubmitting}
                  onClick={stopRecording}
                  type="button"
                >
                  <Square />
                  {t("stopAndSave")}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AddCardContext.Provider>
  );
}

// The New menu's items, each with its app action's key.
const NEW_NOTE_KEY = appActionKeys("newNote")[0];
const UPLOAD_KEY = appActionKeys("uploadFiles")[0];
const RECORD_KEY = appActionKeys("recordAudio")[0];

function NewMenuItems({
  controls,
  runAfterClose,
}: {
  controls: AddCardControls;
  /** What to do once the menu has closed, instead of focusing its trigger. */
  runAfterClose: (action: () => void) => void;
}) {
  const t = useTranslations("forms.addCardActions");
  // Key hints mean nothing without a keyboard.
  const hint = (key: string) => (
    <DropdownMenuShortcut aria-hidden className="pointer-coarse:hidden">
      {key}
    </DropdownMenuShortcut>
  );
  const { newNote } = controls;
  // The file picker or the recording dialog has focus now: the closing
  // menu mustn't take it back for its trigger.
  const keepFocus = () => runAfterClose(() => undefined);
  return (
    <>
      {newNote ? (
        <DropdownMenuItem
          aria-keyshortcuts={NEW_NOTE_KEY}
          onSelect={() => {
            // The composer takes focus once the menu has let go of it.
            runAfterClose(newNote);
          }}
        >
          <PenLine />
          {t("noteOrLink")}
          {hint(NEW_NOTE_KEY)}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        aria-keyshortcuts={UPLOAD_KEY}
        disabled={controls.isUploading}
        onSelect={() => {
          keepFocus();
          // The file picker opens only straight from the person's press.
          controls.uploadFiles();
        }}
      >
        <Upload />
        {t("uploadFiles")}
        {hint(UPLOAD_KEY)}
      </DropdownMenuItem>
      <DropdownMenuItem
        aria-keyshortcuts={RECORD_KEY}
        disabled={!controls.canStartRecording}
        onSelect={() => {
          keepFocus();
          controls.recordAudio();
        }}
      >
        <Mic />
        {t("recordAudio")}
        {hint(RECORD_KEY)}
      </DropdownMenuItem>
    </>
  );
}

function NewMenu({
  align = "start",
  controls,
  trigger,
}: {
  align?: "start" | "end";
  controls: AddCardControls;
  trigger: ReactNode;
}) {
  const { onCloseAutoFocus, runAfterClose } = useRunAfterClose();
  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent
        align={align}
        className="w-52"
        onCloseAutoFocus={onCloseAutoFocus}
        onKeyDown={runMenuItemShortcut}
        side="bottom"
      >
        <NewMenuItems controls={controls} runAfterClose={runAfterClose} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The sidebar's New menu. It uses the AddCardProvider the app shell mounts,
 * which owns uploading and recording.
 */
export function AddCardActions() {
  const controls = useContext(AddCardContext);
  if (!controls) {
    return null;
  }
  return <NewMenu controls={controls} trigger={<NewMenuTrigger />} />;
}

/**
 * The phone header's "+": the New menu where the sidebar, and its New
 * button, is hidden. Wider screens don't show it.
 */
export function AddCardButton({ className }: { className?: string }) {
  const t = useTranslations("forms.addCardActions");
  const controls = useContext(AddCardContext);
  if (!controls) {
    return null;
  }
  return (
    <NewMenu
      align="end"
      controls={controls}
      trigger={
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("new")}
            className={cn(
              "size-9 shrink-0 text-muted-foreground md:hidden",
              className
            )}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Plus className="size-4" />
          </Button>
        </DropdownMenuTrigger>
      }
    />
  );
}
