import { api } from "@teak/convex";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { inferFileFormat } from "@teak/convex/shared/file-formats";
import {
  type FinalizeUploadedCardArgs,
  type UploadAndCreateCardArgs,
  useFileUploadCore,
} from "@teak/convex/shared/hooks/useFileUpload";
import { trackCardCreateAttempt } from "@teak/convex/shared/metrics";
import { Button } from "@teak/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import {
  MANUAL_CLOSE_TOAST_OPTIONS,
  TOAST_IDS,
} from "@teak/ui/constants/toast";
import { useGlobalFileDrop } from "@teak/ui/hooks";
import { useAction, useMutation } from "convex/react";
import { Mic, Square, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "../../convexQueryHooks";

interface AddCardActionsProps {
  onSuccess?: () => void;
  onUpgrade?: () => void;
  upgradeUrl?: string;
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AddCardActions({
  onSuccess,
  onUpgrade,
  upgradeUrl = "/settings",
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

  const uploadAndCreateCard = (args: UploadAndCreateCardArgs) =>
    uploadAndCreateCardMutation(args);

  const finalizeUploadedCard = (args: FinalizeUploadedCardArgs) =>
    finalizeUploadedCardAction(args);

  const { uploadFile } = useFileUploadCore({
    uploadAndCreateCard,
    finalizeUploadedCard,
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
    async (blob: Blob) => {
      const toastId = toast.loading("Saving audio recording...");

      try {
        setIsSubmitting(true);

        const file = new File([blob], `recording_${Date.now()}.webm`, {
          type: blob.type,
        });

        trackCardCreateAttempt({
          cardType: "audio",
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
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      const chunks: Blob[] = [];

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm;codecs=opus" });
        clearRecordingResources();
        void autoSaveAudio(blob);
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
        trackCardCreateAttempt({
          cardType:
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

  return (
    <>
      <div className="flex items-center gap-1">
        <Button
          aria-label="Upload files"
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
