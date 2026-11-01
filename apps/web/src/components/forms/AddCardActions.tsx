import { api } from "@teak/convex";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import { useAction, useMutation } from "convex/react";
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
import { MANUAL_CLOSE_TOAST_OPTIONS, TOAST_IDS } from "@/constants/toast";
import { useGlobalFileDrop } from "@/hooks";
import {
  type FinalizeUploadedCardArgs,
  type UploadAndCreateCardArgs,
  useFileUploadCore,
} from "@/hooks/useFileUploadCore";
import { useServerErrors } from "@/hooks/useServerErrors";
import { SETTINGS_PLAN_HREF } from "@/lib/settingsSections";
import {
  describeUploadFailures,
  uploadAcceptAttribute,
  uploadFailureKind,
} from "@/lib/upload/fileDrop";
import { cn } from "@/lib/utils";
import { useQuery } from "../../lib/convexQueryHooks";
import {
  registerRecordAudio,
  registerUploadFiles,
} from "../../lib/keyboardShortcuts";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

interface AddCardActionsProps {
  onNewNote?: () => void;
  onSuccess?: () => void;
  onUpgrade?: () => void;
  upgradeUrl?: string;
  variant?: "toolbar" | "header";
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

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
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

type AddCardProviderProps = Omit<AddCardActionsProps, "variant"> & {
  children: ReactNode;
};

/**
 * Owns uploading and recording, and the U and R shortcuts, for everything
 * inside it. The app shell mounts it once so they work while the phone's
 * menu, which holds the New button, is closed.
 */
export function AddCardProvider({
  children,
  onNewNote,
  onSuccess,
  onUpgrade,
  upgradeUrl = SETTINGS_PLAN_HREF,
}: AddCardProviderProps) {
  const t = useTranslations("forms.addCardActions");
  const tLimits = useTranslations("forms.limits");
  const tc = useTranslations("common");
  const errors = useServerErrors();
  const tUpload = useTranslations("hooks.upload");
  const tErrors = useTranslations("errors");
  const tUploadMessages = useTranslations("lib.upload");
  const intlLocale = useIntlLocale();
  const uploadTranslators = useMemo(
    () => ({ errors: tErrors, upload: tUpload }),
    [tErrors, tUpload]
  );
  const [isRecordingDialogOpen, setIsRecordingDialogOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A recording whose save failed, kept so it can be saved again or
  // downloaded rather than lost.
  const [unsaved, setUnsaved] = useState<{
    blob: Blob;
    error: string;
    extension: string;
  } | null>(null);

  const cardCreationStatus = useQuery(api.auth.getCardCreationStatus);
  const canCreateCard = cardCreationStatus?.canCreateCard ?? true;
  const globalFileDrop = useGlobalFileDrop();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Counts recording starts; closing the dialog while the microphone prompt
  // is open moves it on, so the start that was waiting is dropped.
  const startAttemptRef = useRef(0);

  const uploadAndCreateCardMutation = useMutation(
    api.cards.uploadAndCreateCard
  );
  const finalizeUploadedCardAction = useAction(api.cards.finalizeUploadedCard);
  const prepareMultipartUpload = useAction(
    api.fileUploads.prepareMultipartUpload
  );
  const completeMultipartUpload = useAction(
    api.fileUploads.completeMultipartUpload
  );
  const recordMultipartPart = useMutation(api.fileUploads.recordMultipartPart);

  const uploadAndCreateCard = (args: UploadAndCreateCardArgs) =>
    uploadAndCreateCardMutation(args);

  const finalizeUploadedCard = (args: FinalizeUploadedCardArgs) =>
    finalizeUploadedCardAction({ ...args, source: "web" });

  const { uploadFile } = useFileUploadCore(
    {
      completeMultipartUpload,
      uploadAndCreateCard,
      finalizeUploadedCard,
      prepareMultipartUpload,
      recordMultipartPart,
    },
    {},
    uploadTranslators
  );

  const handleUpgrade = useCallback(() => {
    if (onUpgrade) {
      onUpgrade();
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    window.location.assign(upgradeUrl);
  }, [onUpgrade, upgradeUrl]);

  const showUpgradeToast = useCallback(
    (toastId: string | number = TOAST_IDS.cardLimit) => {
      toast.error(tLimits("cardLimitReached"), {
        ...MANUAL_CLOSE_TOAST_OPTIONS,
        action: {
          label: tLimits("upgrade"),
          onClick: handleUpgrade,
        },
        id: toastId,
      });
    },
    [handleUpgrade, tLimits]
  );

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
      const keep = (error: string) => setUnsaved({ blob, error, extension });

      try {
        setIsSubmitting(true);
        setUnsaved(null);

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
          setRecordingTime(0);
          setIsRecordingDialogOpen(false);
          onSuccess?.();
          toast.success(t("recordingSaved"), { id: toastId });
          return;
        }

        if (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
          showUpgradeToast(toastId);
          keep(tLimits("cardLimitReached"));
          return;
        }

        if (result.errorCode === CARD_ERROR_CODES.RATE_LIMITED) {
          toast.dismiss(toastId);
          keep(tLimits("rateLimited"));
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
    [onSuccess, showUpgradeToast, t, tLimits, uploadFile]
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
    if (isSubmitting) {
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

    input.onchange = async (event) => {
      const files = Array.from((event.target as HTMLInputElement).files || []);
      input.remove();

      if (files.length === 0) {
        return;
      }

      if (globalFileDrop) {
        globalFileDrop.enqueueFiles(files);
        return;
      }

      for (const file of files) {
        const toastId = toast.loading(t("uploading", { name: file.name }));
        captureEvent("card_create_submitted", {
          card_type:
            inferFileFormat({ fileName: file.name, mimeType: file.type })
              ?.cardType ?? "document",
          source: "web",
          via: "file_upload",
        });
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        const result = await uploadFile(file, { content: "" });

        if (result.success) {
          toast.success(t("uploaded", { name: file.name }), { id: toastId });
          onSuccess?.();
          continue;
        }

        if (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
          showUpgradeToast(toastId);
          break;
        }
        if (result.errorCode === CARD_ERROR_CODES.RATE_LIMITED) {
          toast.error(tLimits("rateLimited"), {
            id: toastId,
          });
          break;
        }

        toast.error(
          uploadFailureKind(result) === "other"
            ? t("uploadFailed", {
                name: file.name,
                error: result.error
                  ? errors.byEnglishMessage(result.error)
                  : t("uploadFailedReason"),
              })
            : describeUploadFailures(
                [{ ...result, file: file.name }],
                tUploadMessages,
                intlLocale
              ),
          { ...MANUAL_CLOSE_TOAST_OPTIONS, id: toastId }
        );
      }
    };

    document.body.appendChild(input);
    input.click();
  };

  let recordingStatusDescription = t("startingMicrophone");
  if (unsaved && !isSubmitting) {
    recordingStatusDescription = unsaved.error;
  } else if (isSubmitting) {
    recordingStatusDescription = t("savingRecordingStatus");
  } else if (isRecording) {
    recordingStatusDescription = t("recordingHint");
  }

  const uploadRef = useRef(handleFileUpload);
  uploadRef.current = handleFileUpload;
  const isUploading = globalFileDrop?.isUploading ?? false;
  useEffect(
    () =>
      registerUploadFiles(() => {
        if (isUploading) {
          return false;
        }
        uploadRef.current();
        return true;
      }),
    [isUploading]
  );
  const recordRef = useRef(startRecording);
  recordRef.current = startRecording;
  const canStartRecording = !(isRecording || isSubmitting || unsaved);
  useEffect(
    () =>
      registerRecordAudio(() => {
        if (!canStartRecording) {
          return false;
        }
        recordRef.current().catch(() => undefined);
        return true;
      }),
    [canStartRecording]
  );
  const uploadFiles = useCallback(() => uploadRef.current(), []);
  const recordAudio = useCallback(() => {
    recordRef.current().catch(() => undefined);
  }, []);
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
      {children}

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
              {formatTime(recordingTime)}
            </div>
            {unsaved && !isSubmitting ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button
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

function NewMenuItems({
  controls,
  keepFocusRef,
}: {
  controls: AddCardControls;
  keepFocusRef: { current: boolean };
}) {
  const t = useTranslations("forms.addCardActions");
  // Key hints mean nothing without a keyboard.
  const hint = (key: string) => (
    <DropdownMenuShortcut aria-hidden className="pointer-coarse:hidden">
      {key}
    </DropdownMenuShortcut>
  );
  const { newNote } = controls;
  return (
    <>
      {newNote ? (
        <DropdownMenuItem
          aria-keyshortcuts="N"
          onSelect={() => {
            keepFocusRef.current = true;
            setTimeout(newNote, 0);
          }}
        >
          <PenLine />
          {t("noteOrLink")}
          {hint("N")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        aria-keyshortcuts="U"
        disabled={controls.isUploading}
        onSelect={() => {
          keepFocusRef.current = true;
          controls.uploadFiles();
        }}
      >
        <Upload />
        {t("uploadFiles")}
        {hint("U")}
      </DropdownMenuItem>
      <DropdownMenuItem
        aria-keyshortcuts="R"
        disabled={!controls.canStartRecording}
        onSelect={() => {
          keepFocusRef.current = true;
          controls.recordAudio();
        }}
      >
        <Mic />
        {t("recordAudio")}
        {hint("R")}
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
  const keepFocusRef = useRef<boolean>(false);
  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent
        align={align}
        className="w-52"
        onCloseAutoFocus={(event) => {
          if (keepFocusRef.current) {
            keepFocusRef.current = false;
            event.preventDefault();
          }
        }}
        side="bottom"
      >
        <NewMenuItems controls={controls} keepFocusRef={keepFocusRef} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddCardTriggers({
  controls,
  variant,
}: {
  controls: AddCardControls;
  variant: "toolbar" | "header";
}) {
  const t = useTranslations("forms.addCardActions");
  if (variant === "header") {
    return <NewMenu controls={controls} trigger={<NewMenuTrigger />} />;
  }
  return (
    <div className="flex items-center gap-1">
      <ShortcutTooltip keys={["U"]} label={t("uploadFiles")}>
        <Button
          aria-keyshortcuts="U"
          aria-label={t("uploadFiles")}
          disabled={controls.isUploading}
          onClick={controls.uploadFiles}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Upload className="size-4" />
        </Button>
      </ShortcutTooltip>
      <ShortcutTooltip keys={["R"]} label={t("recordAudio")}>
        <Button
          aria-keyshortcuts="R"
          aria-label={t("recordAudio")}
          disabled={!controls.canStartRecording}
          onClick={controls.recordAudio}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Mic className="size-4" />
        </Button>
      </ShortcutTooltip>
    </div>
  );
}

/**
 * The New menu, or upload and record buttons. Inside an AddCardProvider it
 * uses that provider; on its own it brings one.
 */
export function AddCardActions({
  variant = "toolbar",
  ...providerProps
}: AddCardActionsProps) {
  const controls = useContext(AddCardContext);
  if (controls) {
    return <AddCardTriggers controls={controls} variant={variant} />;
  }
  return (
    <AddCardProvider {...providerProps}>
      <AddCardActions variant={variant} />
    </AddCardProvider>
  );
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
