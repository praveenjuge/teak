import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import {
  CARD_ERROR_CODES,
  CARD_ERROR_MESSAGES,
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
  resolveTextCardInput,
} from "@teak/convex/shared";
import type { UploadFileResult } from "@teak/convex/shared/types";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@teak/ui/components/ui/alert";
import { Button } from "@teak/ui/components/ui/button";
import { Card, CardContent } from "@teak/ui/components/ui/card";
import { Textarea } from "@teak/ui/components/ui/textarea";
import type { OptimisticLocalStore } from "convex/browser";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { AlertCircle, Mic, Sparkles, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FullScreenAddCardDialog } from "./FullScreenAddCardDialog";

function addCardToSearchQueries(
  localStore: OptimisticLocalStore,
  newCard: Doc<"cards">
) {
  const allQueries = localStore.getAllQueries(api.cards.searchCards);
  for (const { args, value } of allQueries) {
    if (value !== undefined && !args.showTrashOnly) {
      const hasVisualFilters =
        (args.styleFilters?.length ?? 0) > 0 ||
        (args.hueFilters?.length ?? 0) > 0 ||
        (args.hexFilters?.length ?? 0) > 0;
      if (hasVisualFilters) {
        continue;
      }

      const matchesType =
        !args.types ||
        args.types.length === 0 ||
        args.types.includes(newCard.type);
      const matchesFavorites = !args.favoritesOnly || newCard.isFavorited;

      if (matchesType && matchesFavorites) {
        localStore.setQuery(api.cards.searchCards, args, [newCard, ...value]);
      }
    }
  }
}

export interface AddCardFormProps {
  autoFocus?: boolean;
  canCreateCard?: boolean;
  onSuccess?: () => void;
  UpgradeLinkComponent?: React.ComponentType<{
    href: string;
    children: React.ReactNode;
    className?: string;
  }>;
  upgradeUrl?: string;
  uploadFile: (
    file: File,
    options?: { content?: string; additionalMetadata?: Record<string, unknown> }
  ) => Promise<UploadFileResult>;
}

export function AddCardForm({
  onSuccess,
  autoFocus,
  canCreateCard: canCreateCardProp,
  uploadFile,
  UpgradeLinkComponent,
  upgradeUrl = "/settings",
}: AddCardFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [isFullScreenOpen, setIsFullScreenOpen] = useState(false);
  const [isMac, setIsMac] = useState(false);

  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");

  const currentUser = useQuery(api.auth.getCurrentUser);
  const canCreateCard = canCreateCardProp ?? currentUser?.canCreateCard ?? true;
  const fullscreenShortcutLabel = isMac ? "Cmd+E" : "Ctrl+E";
  const basePlaceholderText = canCreateCard
    ? "Write or add a link..."
    : "Upgrade to Pro to add more cards...";
  const inlinePlaceholderText = canCreateCard
    ? `Write or add a link... ${fullscreenShortcutLabel} to expand`
    : basePlaceholderText;
  const fullScreenPlaceholderText = basePlaceholderText;
  const hasContent = Boolean(content.trim());

  useEffect(() => {
    if (currentUser && !currentUser.canCreateCard) {
      setShowUpgradePrompt(true);
    }
  }, [currentUser]);

  useEffect(() => {
    if (typeof navigator === "undefined") {
      return;
    }
    setIsMac(navigator.platform.includes("Mac"));
  }, []);

  const createCard = useMutation(api.cards.createCard).withOptimisticUpdate(
    (localStore, args) => {
      const now = Date.now();
      const contentTrimmed = args.content?.trim() || "";
      const resolved = resolveTextCardInput({
        content: args.content ?? "",
        url: args.url,
      });
      const resolvedType = args.type ?? resolved.type;
      const resolvedUrl = args.url ?? resolved.url;

      const optimisticCard: Doc<"cards"> = {
        _id: crypto.randomUUID() as Id<"cards">,
        _creationTime: now,
        userId: "",
        content: contentTrimmed,
        type: resolvedType,
        url: resolvedUrl,
        createdAt: now,
        updatedAt: now,
      };

      addCardToSearchQueries(localStore, optimisticCard);
    }
  );

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
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
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
        for (const track of stream.getTracks()) {
          track.stop();
        }

        await autoSaveAudio(blob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

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
    const toastId = toast.loading("Saving audio recording...");

    try {
      setIsSubmitting(true);

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
        resetDraft();
        setRecordingTime(0);
        onSuccess?.();
        toast.success("Audio recording saved", { id: toastId });
      } else {
        if (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
          toast.error("Card limit reached", { id: toastId });
          setShowUpgradePrompt(true);
          return;
        }

        if (result.errorCode === CARD_ERROR_CODES.RATE_LIMITED) {
          toast.error("Too many cards created. Please wait a moment.", {
            id: toastId,
          });
          return;
        }

        throw new Error(result.error || "Failed to save audio recording");
      }
    } catch (error) {
      console.error("Failed to auto-save audio:", error);

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to save audio recording";

      toast.error("Failed to save audio recording", { id: toastId });

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

  const handleFileUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "*/*";
    input.multiple = true;
    input.style.display = "none";

    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);

      document.body.removeChild(input);

      if (files.length === 0) {
        return;
      }

      if (files.length > MAX_FILES_PER_UPLOAD) {
        setError(CARD_ERROR_MESSAGES.TOO_MANY_FILES);
        toast.error(
          `You can only upload up to ${MAX_FILES_PER_UPLOAD} files at a time`
        );
        return;
      }

      const oversizedFiles = files.filter((file) => file.size > MAX_FILE_SIZE);
      if (oversizedFiles.length > 0) {
        const fileNames = oversizedFiles.map((f) => f.name).join(", ");
        setError(`Files too large (max 20MB): ${fileNames}`);
        toast.error(`Some files exceed the 20MB limit: ${fileNames}`);
        return;
      }

      for (const file of files) {
        const toastId = toast.loading(`Uploading ${file.name}...`);

        const result = await uploadFile(file, {
          content: "",
        });

        if (result.success) {
          toast.success(`${file.name} uploaded`, { id: toastId });
          onSuccess?.();
        } else {
          if (result.errorCode === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
            toast.error("Card limit reached", { id: toastId });
            setShowUpgradePrompt(true);
            break;
          }
          if (result.errorCode === CARD_ERROR_CODES.RATE_LIMITED) {
            toast.error("Too many cards created. Please wait a moment.", {
              id: toastId,
            });
            break;
          }
          const errorMessage = result.error || "Failed to upload file";
          toast.error(`Failed to upload ${file.name}`, { id: toastId });
          setError(errorMessage);
        }
      }
    };

    document.body.appendChild(input);
    input.click();
  };

  const resetDraft = () => {
    setContent("");
    setUrl("");
  };

  const submitTextCard = async (): Promise<boolean> => {
    if (!(content.trim() && canCreateCard) || isSubmitting) {
      return false;
    }

    const submittedContent = content;
    const submittedUrl = url;
    const resolved = resolveTextCardInput({
      content: submittedContent,
      url: submittedUrl || undefined,
    });
    resetDraft();

    const toastId = toast.loading("Saving card...");
    setIsSubmitting(true);

    try {
      await createCard({
        content: resolved.content,
        type: resolved.type === "link" ? resolved.type : undefined,
        url: resolved.url,
      });

      onSuccess?.();
      toast.success("Card saved", { id: toastId });
      return true;
    } catch (error) {
      console.error("Failed to create card:", error);

      setContent(submittedContent);
      setUrl(submittedUrl);

      const errorMessage =
        error instanceof Error ? error.message : "Failed to create card";

      if (isCardLimitError(error)) {
        setShowUpgradePrompt(true);
        toast.error("Card limit reached", { id: toastId });
      } else if (isRateLimitError(error)) {
        setError("Too many cards created. Please wait a moment and try again.");
        toast.error("Too many cards created. Please wait a moment.", {
          id: toastId,
        });
      } else {
        setError(errorMessage);
        toast.error(errorMessage, { id: toastId });
      }
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitTextCard();
  };

  const handleFullScreenSave = async () => {
    setIsFullScreenOpen(false);
    await submitTextCard();
  };

  const requestFullScreenClose = () => {
    setIsFullScreenOpen(false);
  };

  const handleFullScreenShortcut = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    const isShortcut =
      (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e";
    if (!isShortcut) {
      return false;
    }
    if (!canCreateCard) {
      return false;
    }
    event.preventDefault();
    setIsFullScreenOpen(true);
    return true;
  };

  const renderUpgradePrompt = () => {
    if (!(showUpgradePrompt && !canCreateCard)) {
      return null;
    }

    if (UpgradeLinkComponent) {
      return (
        <UpgradeLinkComponent className="block px-1 pb-1" href={upgradeUrl}>
          <Alert>
            <Sparkles className="stroke-primary" />
            <AlertTitle className="font-medium text-primary">
              Upgrade to Pro
            </AlertTitle>
            <AlertDescription>
              <span className="font-medium text-primary">
                You&apos;ve reached your free tier limit. Upgrade to Pro for
                unlimited cards.
              </span>
            </AlertDescription>
          </Alert>
        </UpgradeLinkComponent>
      );
    }

    return (
      <Alert className="mx-1 mb-1">
        <Sparkles className="stroke-primary" />
        <AlertTitle className="font-medium text-primary">
          Upgrade to Pro
        </AlertTitle>
        <AlertDescription>
          <span className="font-medium text-primary">
            You&apos;ve reached your free tier limit. Upgrade to Pro for
            unlimited cards.
          </span>
        </AlertDescription>
      </Alert>
    );
  };

  if (isRecording) {
    return (
      <Card className="min-h-36 w-full border-red-200 p-4 shadow-none">
        <CardContent className="flex h-full flex-col items-center justify-center gap-4 p-0 text-center">
          <p className="font-medium text-destructive">Recording...</p>

          <Button
            className="gap-0 space-x-0"
            disabled={isSubmitting}
            onClick={stopRecording}
            type="button"
            variant="destructive"
          >
            <Square />
          </Button>

          <p className="font-medium font-mono text-destructive">
            {formatTime(recordingTime)}
          </p>

          {error && (
            <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-center text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <FullScreenAddCardDialog
        canCreateCard={canCreateCard}
        content={content}
        error={error}
        isSubmitting={isSubmitting}
        onContentChange={setContent}
        onRequestClose={requestFullScreenClose}
        onSave={handleFullScreenSave}
        open={isFullScreenOpen}
        placeholder={fullScreenPlaceholderText}
      />
      <Card className="min-h-36 w-full overflow-hidden p-0 shadow-none focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
        <CardContent className="h-full p-0">
          <form
            className="flex h-full flex-1 flex-col"
            onSubmit={handleTextSubmit}
          >
            <Textarea
              autoFocus={autoFocus}
              className="h-full min-h-20 flex-1 resize-none rounded-none border-0 bg-transparent p-4 shadow-none focus-visible:outline-none focus-visible:ring-0 dark:bg-transparent"
              disabled={!canCreateCard}
              id="content"
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if (handleFullScreenShortcut(e)) {
                  return;
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (hasContent && canCreateCard) {
                    handleTextSubmit(
                      e as unknown as React.FormEvent<HTMLFormElement>
                    ).catch(console.error);
                  }
                }
              }}
              placeholder={inlinePlaceholderText}
              ref={textareaRef}
              value={content}
            />

            <div className="flex justify-between gap-2 p-4">
              <div className="flex gap-2">
                <Button
                  disabled={!canCreateCard}
                  onClick={handleFileUpload}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Upload />
                </Button>

                <Button
                  disabled={!canCreateCard}
                  onClick={startRecording}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Mic />
                </Button>
              </div>
              {hasContent && (
                <Button
                  disabled={!canCreateCard || isSubmitting}
                  size="sm"
                  type="submit"
                >
                  Save
                </Button>
              )}
            </div>
          </form>

          {error && (
            <Alert
              className="rounded-none border-0 border-t"
              variant="destructive"
            >
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {renderUpgradePrompt()}
        </CardContent>
      </Card>
    </>
  );
}
