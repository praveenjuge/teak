import { api } from "@teak/convex";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { captureEvent } from "@teak/convex/shared/analytics";
import { inferFileFormat } from "@teak/convex/shared/file-formats";
import {
  type FinalizeUploadedCardArgs,
  type UploadAndCreateCardArgs,
  useFileUploadCore,
} from "@teak/convex/shared/hooks/useFileUpload";
import { Button } from "@teak/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@teak/ui/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@teak/ui/components/ui/tooltip";
import {
  MANUAL_CLOSE_TOAST_OPTIONS,
  TOAST_IDS,
} from "@teak/ui/constants/toast";
import { useGlobalFileDrop } from "@teak/ui/hooks";
import { useAction, useMutation } from "convex/react";
import { Mic, PenLine, Plus, Square, Upload } from "lucide-react";
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useQuery } from "../../convexQueryHooks";
import { registerUploadFiles } from "../../lib/keyboardShortcuts";

interface AddCardActionsProps {
  /** Starts a note (or a pasted link) in the composer; offered in the menu. */
  onNewNote?: () => void;
  onSuccess?: () => void;
  onUpgrade?: () => void;
  upgradeUrl?: string;
  /**
   * `toolbar` renders icon buttons; `header` renders one New button for the
   * sidebar's top row whose menu holds every way to add a card.
   */
  variant?: "toolbar" | "header";
}

/** The sidebar's New button, with its tooltip. */
const NEW_MENU_TRIGGER_CLASS =
  "size-7 rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground [&_svg]:size-4";

/** The sidebar's New button while the app signs in: it looks the same. */
export function NewMenuPlaceholder() {
  return (
    <Button
      aria-label="New"
      className={NEW_MENU_TRIGGER_CLASS}
      disabled
      size="icon"
      type="button"
      variant="ghost"
    >
      <Plus />
    </Button>
  );
}

function NewMenuTrigger(props: ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="New"
            className={NEW_MENU_TRIGGER_CLASS}
            size="icon"
            type="button"
            variant="ghost"
            {...props}
          >
            <Plus />
          </Button>
        </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent side="right">New</TooltipContent>
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
  upgradeUrl = "/settings",
  variant = "toolbar",
}: AddCardActionsProps) {
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

  const uploadAndCreateCardMutation = useMutation(
    api.cards.uploadAndCreateCard
  );
  const finalizeUploadedCardAction = useAction(api.cards.finalizeUploadedCard);
  const prepareMultipartUpload = useAction(
    (api as any).fileUploads.prepareMultipartUpload
  );
  const completeMultipartUpload = useAction(
    (api as any).fileUploads.completeMultipartUpload
  );
  const recordMultipartPart = useMutation(
    (api as any).fileUploads.recordMultipartPart
  );

  const uploadAndCreateCard = (args: UploadAndCreateCardArgs) =>
    uploadAndCreateCardMutation(args);

  const finalizeUploadedCard = (args: FinalizeUploadedCardArgs) =>
    finalizeUploadedCardAction({ ...args, source: "web" });

  const { uploadFile } = useFileUploadCore({
    completeMultipartUpload,
    uploadAndCreateCard,
    finalizeUploadedCard,
    prepareMultipartUpload,
    recordMultipartPart,
  });

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
      toast.error(
        "You've reached your free tier limit. Upgrade to Pro for unlimited cards.",
        {
          ...MANUAL_CLOSE_TOAST_OPTIONS,
          action: {
            label: "Upgrade",
            onClick: handleUpgrade,
          },
          id: toastId,
        }
      );
    },
    [handleUpgrade]
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
      const toastId = toast.loading("Saving audio recording...");

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
          toast.success("Audio recording saved", { id: toastId });
          return;
        }

        if (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
          showUpgradeToast(toastId);
          return;
        }

        if (result.errorCode === CARD_ERROR_CODES.RATE_LIMITED) {
          toast.error("Too many cards created. Please wait a moment.", {
            id: toastId,
          });
          return;
        }

        throw new Error(result.error || "Failed to save audio recording");
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : "Failed to save audio recording";
        toast.error(errorMessage, { id: toastId });
      } finally {
        setIsSubmitting(false);
      }
    },
    [onSuccess, showUpgradeToast, uploadFile]
  );

  const startRecording = useCallback(async () => {
    if (!canCreateCard) {
      showUpgradeToast();
      return;
    }

    setIsRecordingDialogOpen(true);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        toast.error("Microphone recording is not supported in this app.");
        setIsRecordingDialogOpen(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      clearRecordingResources();
      setIsRecording(false);
      setIsRecordingDialogOpen(false);

      if (error instanceof DOMException && error.name === "NotAllowedError") {
        toast.error("Microphone permission was denied. Allow it and retry.");
        return;
      }

      if (error instanceof DOMException && error.name === "NotFoundError") {
        toast.error("No microphone was detected. Connect one and retry.");
        return;
      }

      toast.error("Failed to start recording. Check your microphone setup.");
    }
  }, [autoSaveAudio, canCreateCard, clearRecordingResources, showUpgradeToast]);

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

  const handleDialogOpenChange = (open: boolean) => {
    if (open) {
      setIsRecordingDialogOpen(true);
      return;
    }
    if (isRecording) {
      stopRecording();
      return;
    }
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
        const toastId = toast.loading(`Uploading ${file.name}...`);
        captureEvent("card_create_submitted", {
          card_type:
            inferFileFormat({ fileName: file.name, mimeType: file.type })
              ?.cardType ?? "document",
          source: "web",
          via: "file_upload",
        });
        // Uploads run sequentially so we can stop early when the card limit is
        // hit and surface per-file progress in order.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        const result = await uploadFile(file, { content: "" });

        if (result.success) {
          toast.success(`${file.name} uploaded`, { id: toastId });
          onSuccess?.();
          continue;
        }

        if (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
          showUpgradeToast(toastId);
          break;
        }
        if (result.errorCode === CARD_ERROR_CODES.RATE_LIMITED) {
          toast.error("Too many cards created. Please wait a moment.", {
            id: toastId,
          });
          break;
        }

        toast.error(
          `Failed to upload ${file.name}: ${result.error || "Upload failed"}`,
          { ...MANUAL_CLOSE_TOAST_OPTIONS, id: toastId }
        );
      }
    };

    document.body.appendChild(input);
    input.click();
  };

  const recordingStatusDescription = isRecording
    ? "Speak naturally. Teak will save this as an audio card."
    : "Starting microphone...";

  // `U` uploads through the New menu, which keeps no button on the page.
  const uploadRef = useRef(handleFileUpload);
  uploadRef.current = handleFileUpload;
  const isUploading = globalFileDrop?.isUploading ?? false;
  useEffect(() => {
    if (variant !== "header") {
      return;
    }
    return registerUploadFiles(() => {
      if (isUploading) {
        return false;
      }
      uploadRef.current();
      return true;
    });
  }, [isUploading, variant]);
  // An item that moves focus (the composer, the file picker) keeps it; only
  // Escape or a click away hands focus back to the New button.
  const keepFocusRef = useRef(false);

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
          {onNewNote && (
            <DropdownMenuItem
              onSelect={() => {
                keepFocusRef.current = true;
                // After the menu has closed, so its focus trap lets go.
                setTimeout(onNewNote, 0);
              }}
            >
              <PenLine />
              Note or link
              <DropdownMenuShortcut>N</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={isUploading}
            onSelect={() => {
              keepFocusRef.current = true;
              handleFileUpload();
            }}
          >
            <Upload />
            Upload files
            <DropdownMenuShortcut>U</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isRecording || isSubmitting}
            onSelect={() => {
              keepFocusRef.current = true;
              startRecording().catch(() => undefined);
            }}
          >
            <Mic />
            Record audio
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <div className="flex items-center gap-1">
        <Button
          aria-keyshortcuts="U"
          aria-label="Upload files"
          data-upload-files=""
          disabled={globalFileDrop?.isUploading}
          onClick={handleFileUpload}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Upload className="size-4" />
        </Button>
        <Button
          aria-label="Record audio"
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
        <DialogContent className="max-w-sm text-center" showCloseButton={false}>
          <DialogTitle>Recording audio</DialogTitle>
          <DialogDescription>
            {isSubmitting ? "Saving recording..." : recordingStatusDescription}
          </DialogDescription>
          <div className="flex flex-col items-center gap-4 py-3">
            <div className="font-mono text-2xl text-primary tabular-nums">
              {formatTime(recordingTime)}
            </div>
            <Button
              disabled={!isRecording || isSubmitting}
              onClick={stopRecording}
              type="button"
            >
              <Square />
              Stop and Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
