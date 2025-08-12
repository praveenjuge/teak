import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, Square, Upload } from "lucide-react";
import { api } from "../convex/_generated/api";
import type { CardType } from "@/lib/constants";

// File type categorization
const getFileCardType = (file: File): CardType => {
  const mimeType = file.type.toLowerCase();

  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";

  // Everything else becomes a document card
  return "document";
};

// Get image dimensions
const getImageDimensions = (
  file: File
): Promise<{ width: number; height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };

    img.src = objectUrl;
  });
};

interface AddCardFormProps {
  onSuccess?: () => void;
}

export function AddCardForm({ onSuccess }: AddCardFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<"none" | "audio" | "file">(
    "none"
  );

  // Form data
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");

  const createCard = useMutation(api.cards.createCard);
  const generateUploadUrl = useMutation(api.cards.generateUploadUrl);
  const canCreateCardBasic = useQuery(api.cards.canCreateCard);
  const isSubscribed = useQuery(api.polar.userHasPremium);

  // Combine subscription status with basic card limit check
  const canCreateCard = !!isSubscribed || !!canCreateCardBasic;

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
      setUploadingType("audio");
      setIsSubmitting(true);

      // Upload the audio file
      const uploadUrl = await generateUploadUrl({
        fileName: `recording_${Date.now()}.webm`,
        fileType: blob.type,
      });
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      const { storageId } = await result.json();

      const metadata = {
        fileName: `recording_${Date.now()}.webm`,
        fileSize: blob.size,
        mimeType: blob.type,
      };

      await createCard({
        content: "",
        type: "audio",
        fileId: storageId,
        metadata,
      });

      // Reset form
      setContent("");
      setUrl("");
      setRecordingTime(0);

      onSuccess?.();
    } catch (error) {
      console.error("Failed to auto-save audio:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to save audio recording";
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
      setUploadingType("none");
    }
  };

  const handleFileUpload = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "*/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        // Auto-upload immediately
        try {
          setUploadingType("file");
          setIsSubmitting(true);

          const uploadUrl = await generateUploadUrl({
            fileName: file.name,
            fileType: file.type,
          });
          const result = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": file.type },
            body: file,
          });
          const { storageId } = await result.json();

          const metadata: Record<string, unknown> = {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
          };

          // Get image dimensions if it's an image file
          const fileType = getFileCardType(file);
          if (fileType === "image") {
            try {
              const dimensions = await getImageDimensions(file);
              metadata.width = dimensions.width;
              metadata.height = dimensions.height;
            } catch (error) {
              console.warn("Failed to get image dimensions:", error);
            }
          }

          await createCard({
            content: "",
            type: getFileCardType(file),
            fileId: storageId,
            metadata,
          });

          onSuccess?.();
        } catch (error) {
          console.error("Failed to auto-save file:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Failed to upload file";
          setError(errorMessage);
        } finally {
          setIsSubmitting(false);
          setUploadingType("none");
        }
      }
    };
    input.click();
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Only handle text content here
    if (!content.trim()) return;

    setIsSubmitting(true);

    try {
      let finalContent = content;
      let finalUrl = url;
      let cardType: CardType;

      // Smart detection: if content is only a URL, make it a link card
      const trimmedContent = content.trim();
      const urlPattern = /^https?:\/\/[^\s]+$/;

      if (urlPattern.test(trimmedContent)) {
        cardType = "link";
        finalUrl = trimmedContent;
        finalContent = trimmedContent;
      } else {
        cardType = "text";
        // Extract URL from text content if present
        const urlMatch = trimmedContent.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) {
          finalUrl = urlMatch[1];
        }
      }

      await createCard({
        content: finalContent,
        type: cardType,
        url: finalUrl || undefined,
      });

      // Reset form
      setContent("");
      setUrl("");

      onSuccess?.();
    } catch (error) {
      console.error("Failed to create card:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create card";
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Recording mode - full screen recording interface
  if (isRecording) {
    return (
      <Card className="shadow-none p-4 border-red-200">
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
  if (isSubmitting && uploadingType !== "none") {
    return (
      <Card className="shadow-none p-4 border-blue-200">
        <CardContent className="text-center flex flex-col gap-4 h-full justify-center items-center p-0">
          <h3 className="font-medium text-blue-600">
            {uploadingType === "audio"
              ? "Uploading audio..."
              : "Uploading file..."}
          </h3>
          <div className="text-muted-foreground">
            Please keep this tab open.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="p-0 shadow-none">
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
            placeholder={
              canCreateCard === false
                ? "Card limit reached. Upgrade to Pro for unlimited cards."
                : "Write or paste a link..."
            }
            className="min-h-[80px] flex-1 h-full resize-none border-0 shadow-none rounded-none p-4 focus-visible:outline-none focus-visible:ring-0"
            disabled={canCreateCard === false}
          />

          {/* Action Buttons Row */}
          <div className="flex gap-2 justify-between p-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFileUpload}
                disabled={isSubmitting || canCreateCard === false}
              >
                <Upload />
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={startRecording}
                disabled={isSubmitting || canCreateCard === false}
              >
                <Mic />
              </Button>
            </div>
            {content.trim() && (
              <Button
                type="submit"
                disabled={isSubmitting || canCreateCard === false}
                size="sm"
              >
                {isSubmitting ? "Saving..." : "Save"}
              </Button>
            )}
          </div>
        </form>

        {error && (
          <div className="p-2 bg-red-50 border border-red-200 rounded text-red-600">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
