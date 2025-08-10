import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, Square, Upload } from "lucide-react";
import { api } from "../convex/_generated/api";
import type { CardType } from "@/lib/types";

// File type categorization
const getFileCardType = (file: File): CardType => {
  const mimeType = file.type.toLowerCase();

  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";

  // Everything else becomes a document card
  return "document";
};

interface AddCardFormProps {
  onSuccess?: () => void;
}

export function AddCardForm({ onSuccess }: AddCardFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Form data
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");

  const createCard = useMutation(api.cards.createCard);
  const generateUploadUrl = useMutation(api.cards.generateUploadUrl);

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
        "Failed to start recording. Please check your microphone permissions.",
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
        content: "Audio Recording",
        type: "audio",
        fileId: storageId as any,
        metadata,
      });

      // Reset form
      setContent("");
      setUrl("");
      setRecordingTime(0);

      onSuccess?.();
    } catch (error) {
      console.error("Failed to auto-save audio:", error);
      setError("Failed to save audio recording.");
    } finally {
      setIsSubmitting(false);
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

          const metadata = {
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
          };

          await createCard({
            content: file.name,
            type: getFileCardType(file),
            fileId: storageId as any,
            metadata,
          });

          onSuccess?.();
        } catch (error) {
          console.error("Failed to auto-save file:", error);
          setError("Failed to upload file.");
        } finally {
          setIsSubmitting(false);
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
    } finally {
      setIsSubmitting(false);
    }
  };

  // Recording mode - full screen recording interface
  if (isRecording) {
    return (
      <Card className="mb-6 border-red-200">
        <CardContent className="text-center space-y-6">
          <div>
            <h3 className="text-xl font-medium text-gray-900">Recording...</h3>
            <p className="text-sm text-gray-500 mt-1">Speak now</p>
          </div>

          <div className="text-4xl font-mono text-red-600">
            {formatTime(recordingTime)}
          </div>

          <Button
            type="button"
            onClick={stopRecording}
            size="lg"
            variant="destructive"
            className="rounded-full w-24 h-24 p-0 hover:scale-105 transition-transform"
            disabled={isSubmitting}
          >
            <Square className="w-10 h-10" />
          </Button>

          <p className="text-sm text-gray-600">
            Click to stop and save automatically
          </p>

          {isSubmitting && (
            <p className="text-sm text-blue-600">Saving your recording...</p>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-600 text-sm text-center">
              {error}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-dashed">
      <CardContent className="text-center space-y-3">
        {/* Text Input Form */}
        <form onSubmit={handleTextSubmit} className="space-y-3">
          <div>
            <Textarea
              id="content"
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write text or paste a link..."
              className="text-sm min-h-[80px] resize-none"
            />
          </div>

          {/* Action Buttons Row */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleFileUpload}
              disabled={isSubmitting}
              className="text-xs"
            >
              <Upload className="w-3 h-3 mr-1" />
              Upload
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={startRecording}
              disabled={isSubmitting}
              className="text-xs"
            >
              <Mic className="w-3 h-3 mr-1" />
              Record
            </Button>
          </div>

          {/* Submit Button - Only show if there's text content */}
          {content.trim() && (
            <Button
              type="submit"
              disabled={isSubmitting}
              size="sm"
              className="w-full text-xs"
            >
              {isSubmitting ? "Saving..." : "Save Content"}
            </Button>
          )}
        </form>

        {error && (
          <div className="p-2 bg-red-50 border border-red-200 rounded text-red-600 text-xs">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
