import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import type { OptimisticLocalStore } from "convex/browser";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Mic, Square, Upload, Sparkles, AlertCircle } from "lucide-react";
import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { useFileUpload } from "@/hooks/useFileUpload";
import { CARD_ERROR_CODES } from "@teak/convex/shared";
import { toast } from "sonner";
import * as Sentry from "@sentry/nextjs";
import { metrics } from "@/lib/metrics";
import Link from "next/link";

// Helper to add a new card optimistically to all matching searchCards queries
function addCardToSearchQueries(
  localStore: OptimisticLocalStore,
  newCard: Doc<"cards">
) {
  const allQueries = localStore.getAllQueries(api.cards.searchCards);
  for (const { args, value } of allQueries) {
    if (value !== undefined) {
      // Only add to non-trash queries that match the card's characteristics
      if (!args.showTrashOnly) {
        // Check if the card matches the filters
        const matchesType =
          !args.types ||
          args.types.length === 0 ||
          args.types.includes(newCard.type);
        const matchesFavorites = !args.favoritesOnly || newCard.isFavorited;

        if (matchesType && matchesFavorites) {
          // Add to the beginning of the list (most recent first)
          localStore.setQuery(api.cards.searchCards, args, [newCard, ...value]);
        }
      }
    }
  }
}

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

  // Check if user can create cards on mount
  const currentUser = useQuery(api.auth.getCurrentUser);
  const canCreateCard = currentUser?.canCreateCard ?? true;

  // Show upgrade prompt immediately if user can't create cards
  useEffect(() => {
    if (currentUser && !currentUser.canCreateCard) {
      setShowUpgradePrompt(true);
      metrics.cardLimitReached(currentUser.cardCount);
      metrics.upgradePromptShown("page_load");
    }
  }, [currentUser]);

  const createCard = useMutation(api.cards.createCard).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      // Determine the card type based on content
      const contentTrimmed = args.content?.trim() || "";
      const isUrl = args.url || /^https?:\/\//i.test(contentTrimmed);

      // Create an optimistic card with a temporary ID
      const optimisticCard: Doc<"cards"> = {
        _id: crypto.randomUUID() as Id<"cards">,
        _creationTime: now,
        userId: "", // Will be set by server
        content: contentTrimmed,
        type: isUrl ? "link" : "text",
        url: args.url,
        createdAt: now,
        updatedAt: now,
      };

      addCardToSearchQueries(localStore, optimisticCard);
    }
  );

  // Use shared file upload hook
  const { uploadFile, state: uploadState } = useFileUpload({
    onSuccess: () => {
      onSuccess?.();
    },
    onError: (error) => {
      if (error.code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        setShowUpgradePrompt(true);
      } else {
        setError(error.message);
      }
    },
  });

  const getCardErrorCode = (err: unknown): string | null => {
    if (!err || typeof err !== "object") {
      return null;
    }

    const maybeError = err as {
      code?: string;
      message?: string;
      data?: { code?: string };
    };

    if (
      maybeError.code &&
      Object.values(CARD_ERROR_CODES).includes(
        maybeError.code as (typeof CARD_ERROR_CODES)[keyof typeof CARD_ERROR_CODES]
      )
    ) {
      return maybeError.code;
    }

    if (
      maybeError.data?.code &&
      Object.values(CARD_ERROR_CODES).includes(
        maybeError.data
          .code as (typeof CARD_ERROR_CODES)[keyof typeof CARD_ERROR_CODES]
      )
    ) {
      return maybeError.data.code;
    }

    return null;
  };

  const isCardLimitError = (err: unknown): boolean => {
    return getCardErrorCode(err) === CARD_ERROR_CODES.CARD_LIMIT_REACHED;
  };

  const isRateLimitError = (err: unknown): boolean => {
    return getCardErrorCode(err) === CARD_ERROR_CODES.RATE_LIMITED;
  };

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
      metrics.featureUsed("voice_recording");
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
      Sentry.captureException(err, {
        tags: { source: "client", operation: "startRecording" },
      });
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
        // Track successful audio recording
        metrics.audioRecorded(recordingTime, true);
        metrics.cardCreated("audio");

        // Reset form
        setContent("");
        setUrl("");
        setRecordingTime(0);
        onSuccess?.();
        toast.success("Audio recording saved successfully");
      } else {
        if (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
          metrics.cardLimitReached(0);
          metrics.upgradePromptShown("audio_recording");
          setShowUpgradePrompt(true);
          return;
        }

        if (result.errorCode === CARD_ERROR_CODES.RATE_LIMITED) {
          metrics.rateLimitHit("card_creation");
          setError(
            "Too many cards created. Please wait a moment and try again."
          );
          return;
        }

        metrics.audioRecorded(recordingTime, false);
        throw new Error(result.error || "Failed to save audio recording");
      }
    } catch (error) {
      console.error("Failed to auto-save audio:", error);

      // Capture Convex errors in Sentry
      Sentry.captureException(error, {
        tags: { source: "convex", mutation: "cards:createCard", type: "audio" },
      });

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to save audio recording";

      if (isCardLimitError(error)) {
        setShowUpgradePrompt(true);
      } else if (isRateLimitError(error)) {
        setError("Too many cards created. Please wait a moment and try again.");
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFileUpload = async () => {
    metrics.featureUsed("file_upload");
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "*/*";
    input.style.display = "none"; // Hide the input element

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const result = await uploadFile(file, {
          content: "",
        });

        if (result.success) {
          metrics.fileUploaded(file.size, file.type, true);
          metrics.cardCreated(file.type.split("/")[0] || "document");
          onSuccess?.();
          toast.success(`${file.name} uploaded successfully`);
        } else {
          const errorMessage = result.error || "Failed to upload file";
          metrics.fileUploaded(file.size, file.type, false);
          if (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
            metrics.cardLimitReached(0);
            metrics.upgradePromptShown("file_upload");
            setShowUpgradePrompt(true);
          } else if (result.errorCode === CARD_ERROR_CODES.RATE_LIMITED) {
            metrics.rateLimitHit("card_creation");
            setError(
              "Too many cards created. Please wait a moment and try again."
            );
          } else {
            metrics.errorOccurred("upload", result.errorCode);
            setError(errorMessage);
          }
        }
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

    metrics.featureUsed("quick_add");

    // Reset form immediately - card appears optimistically
    const submittedContent = content;
    const submittedUrl = url;
    setContent("");
    setUrl("");

    try {
      // Let backend handle type detection and processing
      await createCard({
        content: submittedContent,
        url: submittedUrl || undefined,
      });

      // Track card creation
      metrics.cardCreated(submittedUrl ? "link" : "text");

      onSuccess?.();
    } catch (error) {
      console.error("Failed to create card:", error);

      // Restore form content on error so user can retry
      setContent(submittedContent);
      setUrl(submittedUrl);

      // Capture Convex errors in Sentry
      Sentry.captureException(error, {
        tags: { source: "convex", mutation: "cards:createCard" },
        extra: {
          content: submittedContent?.slice(0, 100),
          hasUrl: !!submittedUrl,
        },
      });

      const errorMessage =
        error instanceof Error ? error.message : "Failed to create card";

      if (isCardLimitError(error)) {
        setShowUpgradePrompt(true);
      } else if (isRateLimitError(error)) {
        setError("Too many cards created. Please wait a moment and try again.");
      } else {
        setError(errorMessage);
      }
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
  if (uploadState.isUploading) {
    return (
      <Card className="shadow-none p-4 border-primary ring-1 ring-primary w-full relative overflow-hidden h-36">
        <CardContent className="text-center flex flex-col gap-4 h-full justify-center items-center p-0 relative">
          <h3 className="font-medium text-primary">Uploading...</h3>
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
                if (content.trim() && canCreateCard) {
                  void handleTextSubmit(
                    e as unknown as React.FormEvent<HTMLFormElement>
                  );
                }
              }
            }}
            autoFocus={autoFocus}
            disabled={!canCreateCard}
            placeholder={
              canCreateCard
                ? "Write or add a link..."
                : "Upgrade to Pro to add more cards..."
            }
            className="min-h-20 flex-1 h-full resize-none border-0 shadow-none rounded-none p-4 focus-visible:outline-none focus-visible:ring-0 bg-transparent dark:bg-transparent"
          />

          {/* Action Buttons Row */}
          <div className="flex gap-2 justify-between p-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleFileUpload}
                disabled={uploadState.isUploading || !canCreateCard}
              >
                <Upload />
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={startRecording}
                disabled={uploadState.isUploading || !canCreateCard}
              >
                <Mic />
              </Button>
            </div>
            {content.trim() && (
              <Button
                type="submit"
                disabled={uploadState.isUploading || !canCreateCard}
                size="sm"
              >
                Save
              </Button>
            )}
          </div>
        </form>

        {error && (
          <Alert
            variant="destructive"
            className="rounded-none border-0 border-t"
          >
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {showUpgradePrompt && !canCreateCard && (
          <Link href="/settings" className="px-1 pb-1 block">
            <Alert>
              <Sparkles className="stroke-primary" />
              <AlertTitle className="text-primary font-medium">
                Upgrade to Pro →
              </AlertTitle>
              <AlertDescription>
                <span className="text-primary font-medium">
                  You&apos;ve reached your free tier limit. Upgrade to Pro for
                  unlimited cards.
                </span>
              </AlertDescription>
            </Alert>
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
