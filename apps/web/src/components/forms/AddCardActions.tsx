import { api } from "@teak/convex";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
import { inferFileFormat } from "@teak/convex/shared/fileFormats";
import { useTranslations } from "@teak/i18n/react";
import { useAction, useMutation } from "convex/react";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Mic, PenLine, Plus, Square, Upload } from "vadivam-react";
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
import { useOptionalSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MANUAL_CLOSE_TOAST_OPTIONS, TOAST_IDS } from "@/constants/toast";
import { useGlobalFileDrop } from "@/hooks";
import {
  type FinalizeUploadedCardArgs,
  type UploadAndCreateCardArgs,
  useFileUploadCore,
} from "@/hooks/useFileUploadCore";
import { useServerErrors } from "@/hooks/useServerErrors";
import { SETTINGS_PLAN_HREF } from "@/lib/settingsSections";
import { useQuery } from "../../lib/convexQueryHooks";
import { registerUploadFiles } from "../../lib/keyboardShortcuts";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

interface AddCardActionsProps {
  onNewNote?: () => void;
  onSuccess?: () => void;
  onUpgrade?: () => void;
  upgradeUrl?: string;
  variant?: "toolbar" | "header";
}

// A labelled button at the top of the sidebar; just its icon in the collapsed rail.
const NEW_MENU_TRIGGER_CLASS =
  "h-8 w-full justify-start gap-2 bg-sidebar px-[9px] font-medium text-[13px] text-sidebar-foreground shadow-none hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 [&_svg]:size-3.5";
const NEW_MENU_LABEL_CLASS = "truncate group-data-[collapsible=icon]:hidden";

export function NewMenuPlaceholder() {
  const t = useTranslations("forms.addCardActions");
  return (
    <Button
      aria-label={t("new")}
      className={NEW_MENU_TRIGGER_CLASS}
      disabled
      type="button"
      variant="outline"
    >
      <Plus />
      <span className={NEW_MENU_LABEL_CLASS}>{t("new")}</span>
    </Button>
  );
}

function NewMenuTrigger(props: ComponentProps<typeof Button>) {
  const t = useTranslations("forms.addCardActions");
  // The button names itself; the tooltip only helps in the collapsed rail.
  const sidebar = useOptionalSidebar();
  const showTooltip =
    sidebar?.state === "collapsed" && !sidebar.isPeeking && !sidebar.isMobile;
  return (
    <Tooltip open={showTooltip ? undefined : false}>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("new")}
            className={NEW_MENU_TRIGGER_CLASS}
            type="button"
            variant="outline"
            {...props}
          >
            <Plus />
            <span className={NEW_MENU_LABEL_CLASS}>{t("new")}</span>
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="right">{t("new")}</TooltipContent>
    </Tooltip>
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

export function AddCardActions({
  onNewNote,
  onSuccess,
  onUpgrade,
  upgradeUrl = SETTINGS_PLAN_HREF,
  variant = "toolbar",
}: AddCardActionsProps) {
  const t = useTranslations("forms.addCardActions");
  const tLimits = useTranslations("forms.limits");
  const errors = useServerErrors();
  const tUpload = useTranslations("hooks.upload");
  const tErrors = useTranslations("errors");
  const uploadTranslators = useMemo(
    () => ({ errors: tErrors, upload: tUpload }),
    [tErrors, tUpload]
  );
  const [isRecordingDialogOpen, setIsRecordingDialogOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

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

      try {
        setIsSubmitting(true);

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
          return;
        }

        if (result.errorCode === CARD_ERROR_CODES.RATE_LIMITED) {
          toast.error(tLimits("rateLimited"), {
            id: toastId,
          });
          return;
        }

        throw new Error(
          result.error
            ? errors.byEnglishMessage(result.error)
            : t("recordingSaveFailed")
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : t("recordingSaveFailed");
        toast.error(errorMessage, { id: toastId });
      } finally {
        setIsSubmitting(false);
      }
    },
    [errors, onSuccess, showUpgradeToast, t, tLimits, uploadFile]
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
      // A start that was closed or replaced owns nothing to clean up.
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
    setIsRecordingDialogOpen(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [isRecording]);

  // Stops the recorder without its save handler, so nothing is kept.
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
    setRecordingTime(0);
    setIsRecordingDialogOpen(false);
  }, [clearRecordingResources]);

  // Esc cancels, as in any dialog: it discards a recording rather than
  // saving it. A stray click outside does nothing while recording.
  const handleDialogOpenChange = (open: boolean) => {
    if (open) {
      setIsRecordingDialogOpen(true);
      return;
    }
    if (isRecording) {
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
    input.accept = "*/*";
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
          t("uploadFailed", {
            name: file.name,
            error: result.error
              ? errors.byEnglishMessage(result.error)
              : t("uploadFailedReason"),
          }),
          { ...MANUAL_CLOSE_TOAST_OPTIONS, id: toastId }
        );
      }
    };

    document.body.appendChild(input);
    input.click();
  };

  let recordingStatusDescription = t("startingMicrophone");
  if (isSubmitting) {
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
  const keepFocusRef = useRef<boolean>(false);

  const triggers =
    variant === "header" ? (
      <DropdownMenu>
        <NewMenuTrigger />
        <DropdownMenuContent
          align="start"
          className="w-52"
          onCloseAutoFocus={(event) => {
            if (keepFocusRef.current) {
              keepFocusRef.current = false;
              event.preventDefault();
            }
          }}
          side="bottom"
        >
          {onNewNote ? (
            <DropdownMenuItem
              onSelect={() => {
                keepFocusRef.current = true;
                setTimeout(onNewNote, 0);
              }}
            >
              <PenLine />
              {t("noteOrLink")}
              <DropdownMenuShortcut>{"N"}</DropdownMenuShortcut>
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            disabled={isUploading}
            onSelect={() => {
              keepFocusRef.current = true;
              handleFileUpload();
            }}
          >
            <Upload />
            {t("uploadFiles")}
            <DropdownMenuShortcut>{"U"}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isRecording || isSubmitting}
            onSelect={() => {
              keepFocusRef.current = true;
              startRecording().catch(() => undefined);
            }}
          >
            <Mic />
            {t("recordAudio")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <div className="flex items-center gap-1">
        <ShortcutTooltip keys={["U"]} label={t("uploadFiles")}>
          <Button
            aria-keyshortcuts="U"
            aria-label={t("uploadFiles")}
            disabled={globalFileDrop?.isUploading}
            onClick={handleFileUpload}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Upload className="size-4" />
          </Button>
        </ShortcutTooltip>
        <Button
          aria-label={t("recordAudio")}
          disabled={isRecording || isSubmitting}
          onClick={() => void startRecording()}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Mic className="size-4" />
        </Button>
      </div>
    );

  return (
    <>
      {triggers}

      <Dialog
        onOpenChange={handleDialogOpenChange}
        open={isRecordingDialogOpen}
      >
        <DialogContent
          className="max-w-sm text-center"
          onInteractOutside={(event) => {
            if (isRecording) {
              event.preventDefault();
            }
          }}
          showCloseButton={false}
        >
          <DialogTitle>{t("recordingTitle")}</DialogTitle>
          <DialogDescription>{recordingStatusDescription}</DialogDescription>
          <div className="flex flex-col items-center gap-4 py-3">
            <div className="font-mono text-2xl text-primary tabular-nums">
              {formatTime(recordingTime)}
            </div>
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
