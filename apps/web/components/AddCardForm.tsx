import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, Square, Upload, Sparkles } from "lucide-react";
import { api } from "@teak/convex";
import { useFileUpload } from "@teak/shared";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

interface AddCardFormProps {
  onSuccess?: () => void;
  autoFocus?: boolean;
}

export function AddCardForm({ onSuccess, autoFocus }: AddCardFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);

  // Form data
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");

  const router = useRouter();
  const createCard = useMutation(api.cards.createCard);

  // Use shared file upload hook
  const { uploadFile, state: uploadState } = useFileUpload({
    onSuccess: () => {
      onSuccess?.();
    },
    onError: (error) => {
      // Check if error is about card limit
      if (
        error.includes("Card limit reached") ||
        error.includes("upgrade to Pro")
      ) {
        setShowUpgradePrompt(true);
      } else {
        setError(error);
      }
    },
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      mediaRecorderRef.current = mediaRecorder;

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm;codecs=opus" });
        stream.getTracks().forEach((track) => track.stop());

        // Auto-save immediately
        await autoSaveAudio(blob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error starting recording:", err);
      setError(
        "Failed to start recording. Please check your microphone permissions."
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  };

  const autoSaveAudio = async (blob: Blob) => {
    try {
      setIsSubmitting(true);

      // Convert blob to File for the shared upload hook
      const file = new File([blob], `recording_${Date.now()}.webm`, {
        type: blob.type,
      });

      const result = await uploadFile(file, {
        content: "",
        additionalMetadata: {
          recordingTimestamp: Date.now(),
        },
      });

      if (result.success) {
        // Reset form
        setContent("");
        setUrl("");
        setRecordingTime(0);
        onSuccess?.();
        toast.success("Audio recording saved successfully");
      } else {
        throw new Error(result.error || "Failed to save audio recording");
      }
    } catch (error) {
      console.error("Failed to auto-save audio:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to save audio recording";

      // Check if error is about card limit
      if (
        errorMessage.includes("Card limit reached") ||
        errorMessage.includes("upgrade to Pro")
      ) {
        setShowUpgradePrompt(true);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileUpload = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "*/*";
    input.style.display = "none"; // Hide the input element

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        setIsSubmitting(true);

        const result = await uploadFile(file, {
          content: "",
        });

        if (result.success) {
          onSuccess?.();
          toast.success(`${file.name} uploaded successfully`);
        } else {
          const errorMessage = result.error || "Failed to upload file";
          // Check if error is about card limit
          if (
            errorMessage.includes("Card limit reached") ||
            errorMessage.includes("upgrade to Pro")
          ) {
            setShowUpgradePrompt(true);
          } else {
            setError(errorMessage);
          }
        }

        setIsSubmitting(false);
      }

      // Clean up the input element
      document.body.removeChild(input);
    };

    // Add to DOM temporarily and trigger click
    document.body.appendChild(input);
    input.click();
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Only handle text content here
    if (!content.trim()) return;

    setIsSubmitting(true);

    try {
      // Let backend handle type detection and processing
      await createCard({
        content: content,
        url: url || undefined,
      });

      // Reset form
      setContent("");
      setUrl("");

      onSuccess?.();
    } catch (error) {
      console.error("Failed to create card:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create card";

      // Check if error is about card limit
      if (
        errorMessage.includes("Card limit reached") ||
        errorMessage.includes("upgrade to Pro")
      ) {
        setShowUpgradePrompt(true);
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Recording mode - full screen recording interface
  if (isRecording) {
    return (
      <Card className="shadow-none p-4 border-red-200 w-full min-h-36">
        <CardContent className="text-center flex flex-col gap-4 h-full justify-center items-center p-0">
          <p className="font-medium text-destructive">Recording...</p>

          <Button
            type="button"
            onClick={stopRecording}
            variant="destructive"
            disabled={isSubmitting}
            className="gap-0 space-x-0"
          >
            <Square />
          </Button>

          <p className="font-mono font-medium text-destructive">
            {formatTime(recordingTime)}
          </p>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-destructive text-center">
              {error}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Uploading mode - full card feedback while files/audio are being uploaded
  if (uploadState.isUploading || isSubmitting) {
    return (
      <Card className="shadow-none p-4 border-primary ring-1 ring-primary w-full relative overflow-hidden h-36">
        <CardContent className="text-center flex flex-col gap-4 h-full justify-center items-center p-0 relative">
          <h3 className="font-medium text-primary">
            {isRecording ? "Processing audio..." : "Saving..."}
          </h3>
        </CardContent>
        {uploadState.progress > 0 && (
          <div
            className="bg-primary/20 h-full absolute top-0 left-0 bottom-0 transition-all duration-300"
            style={{ width: `${uploadState.progress}%` }}
          />
        )}
      </Card>
    );
  }

  // Upgrade prompt mode - show positive upgrade message when limit is hit
  if (showUpgradePrompt) {
    return (
      <Card className="shadow-none p-3 border-primary ring-1 ring-primary w-full min-h-36">
        <CardContent className="text-center flex flex-col gap-3 h-full justify-center items-center p-0">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="size-4 fill-primary" />
            <h3 className="font-medium">Unlock Unlimited Cards</h3>
          </div>
          <p className="text-sm text-muted-foreground max-w-sm">
            You&apos;ve reached your free tier limit. Upgrade to Pro for
            unlimited cards.
          </p>
          <Button
            onClick={() => router.push("/subscription")}
            className="w-full"
          >
            Upgrade →
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="p-0 shadow-none focus-within:border-primary focus-within:ring-1 focus-within:ring-primary overflow-hidden w-full min-h-36">
      <CardContent className="p-0 h-full">
        <form
          onSubmit={handleTextSubmit}
          className="flex flex-col flex-1 h-full"
        >
          <Textarea
            id="content"
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (content.trim()) {
                  handleTextSubmit(
                    e as unknown as React.FormEvent<HTMLFormElement>
                  );
                }
              }
            }}
            autoFocus={autoFocus}
            placeholder="Write or add a link..."
            className="min-h-[80px] flex-1 h-full resize-none border-0 shadow-none rounded-none p-4 focus-visible:outline-none focus-visible:ring-0 bg-transparent dark:bg-transparent"
          />

          {/* Action Buttons Row */}
          <div className="flex gap-2 justify-between p-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFileUpload}
                disabled={isSubmitting || uploadState.isUploading}
              >
                <Upload />
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={startRecording}
                disabled={isSubmitting || uploadState.isUploading}
              >
                <Mic />
              </Button>
            </div>
            {content.trim() && (
              <Button
                type="submit"
                disabled={isSubmitting || uploadState.isUploading}
                size="sm"
              >
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            )}
          </div>
        </form>

        {error && <div className="p-2 bg-red-50 text-destructive">{error}</div>}
      </CardContent>
    </Card>
  );
}
