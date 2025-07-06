import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { apiClient, type Card as CardType } from "@/lib/api";
import { Loader2, Mic, Square, FileUp } from "lucide-react";

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function detectCardType(content: string): {
  type: CardType["type"];
  data: Record<string, any>;
} {
  const trimmedContent = content.trim();

  if (isUrl(trimmedContent)) {
    try {
      const url = new URL(trimmedContent);
      return {
        type: "url",
        data: {
          url: trimmedContent,
          title: url.hostname,
          description: `Saved from ${url.hostname}`,
        },
      };
    } catch {
      // Fallback if URL parsing fails
      return {
        type: "url",
        data: {
          url: trimmedContent,
          title: trimmedContent,
        },
      };
    }
  }

  return {
    type: "text",
    data: {
      content: trimmedContent,
      title:
        trimmedContent.slice(0, 50) + (trimmedContent.length > 50 ? "..." : ""),
    },
  };
}

export function AddCardItem() {
  const [content, setContent] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const createCardMutation = useMutation({
    mutationFn: (cardData: {
      type: CardType["type"];
      data: Record<string, any>;
      metaInfo?: Record<string, any>;
    }) => apiClient.createCard(cardData),
    onMutate: async (newCard) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["cards"] });

      // Snapshot the previous queries
      const previousQueries = queryClient.getQueriesData({
        queryKey: ["cards"],
      });

      // Optimistically update all cards queries
      queryClient.setQueriesData({ queryKey: ["cards"] }, (oldData: any) => {
        if (!oldData || !oldData.cards) return oldData;

        const optimisticCard = {
          id: Date.now(), // Temporary ID
          ...newCard,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          userId: "current-user", // Will be replaced by server response
        };

        return {
          ...oldData,
          cards: [optimisticCard, ...oldData.cards],
          total: oldData.total + 1,
        };
      });

      // Return a context object with the snapshotted value
      return { previousQueries };
    },
    onError: (err, _, context) => {
      // If the mutation fails, restore all previous queries
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      console.error("Failed to save card:", err);
    },
    onSuccess: () => {
      // Invalidate and refetch to get the real data from server
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      setContent("");
      // Focus back to textarea for continuous input
      textareaRef.current?.focus();
    },
  });

  const createFileCardMutation = useMutation({
    mutationFn: ({
      file,
      cardData,
    }: {
      file: File;
      cardData?: {
        type?: CardType["type"];
        data?: Record<string, any>;
        metaInfo?: Record<string, any>;
      };
    }) => apiClient.createCardWithFile(file, cardData, setUploadProgress),
    onMutate: async ({ file, cardData }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["cards"] });

      // Snapshot the previous queries
      const previousQueries = queryClient.getQueriesData({
        queryKey: ["cards"],
      });

      // Create placeholder card while uploading
      const detectedType = detectCardTypeFromFile(file);
      const placeholderCard = {
        id: Date.now(), // Temporary ID
        type: cardData?.type || detectedType,
        data: {
          title: `Uploading ${file.name}...`,
          ...(detectedType === "image" && {
            alt_text: `Uploading image: ${file.name}`,
          }),
          ...(detectedType === "video" && { duration: 0 }),
          ...(detectedType === "audio" && { duration: 0 }),
          ...cardData?.data,
        },
        metaInfo: {
          source: "File Upload",
          uploading: true,
          fileName: file.name,
          fileSize: file.size,
          ...cardData?.metaInfo,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userId: "current-user",
      };

      // Optimistically update all cards queries
      queryClient.setQueriesData({ queryKey: ["cards"] }, (oldData: any) => {
        if (!oldData || !oldData.cards) return oldData;

        return {
          ...oldData,
          cards: [placeholderCard, ...oldData.cards],
          total: oldData.total + 1,
        };
      });

      return { previousQueries, placeholderCard };
    },
    onError: (err, _, context) => {
      // If the mutation fails, restore all previous queries
      if (context?.previousQueries) {
        context.previousQueries.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      console.error("Failed to upload file:", err);
      setUploadProgress(null);
    },
    onSuccess: () => {
      // Invalidate and refetch to get the real data from server
      queryClient.invalidateQueries({ queryKey: ["cards"] });
      setUploadProgress(null);
    },
  });

  // Recording functionality
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Try to use audio/webm first, fallback to default if not supported
      let mimeType = "audio/webm";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/webm;codecs=opus";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = ""; // Use browser default
        }
      }

      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = async () => {
        console.log("Recording stopped, chunks:", chunks.length);
        // Ensure we create an audio blob, not video
        const audioMimeType = mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: audioMimeType });
        console.log("Blob created, size:", blob.size, "type:", blob.type);

        // Create file with audio extension and type
        const fileExtension = audioMimeType.includes("webm") ? "webm" : "wav";
        const file = new File(
          [blob],
          `recording-${Date.now()}.${fileExtension}`,
          {
            type: audioMimeType,
          }
        );
        console.log("File created:", file.name, file.size, file.type);

        // Upload the recorded audio
        console.log("Starting upload mutation...");
        createFileCardMutation.mutate({
          file,
          cardData: {
            type: "audio",
            metaInfo: {
              source: "Voice Recording",
              recordingDuration: recordingDuration,
              tags: ["voice-recording"],
            },
          },
        });

        // Cleanup
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);
        setRecordingDuration(0);
        setMediaRecorder(null);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);

      // Start duration counter
      const startTime = Date.now();
      const interval = setInterval(() => {
        if (recorder.state === "recording") {
          setRecordingDuration(Math.floor((Date.now() - startTime) / 1000));
        } else {
          clearInterval(interval);
        }
      }, 1000);
    } catch (error) {
      console.error("Error starting recording:", error);
      alert("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  };

  const handleAudioRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Format recording duration as MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  function detectCardTypeFromFile(file: File): CardType["type"] {
    if (file.type.startsWith("image/")) {
      return "image";
    } else if (file.type.startsWith("video/")) {
      return "video";
    } else if (file.type.startsWith("audio/")) {
      return "audio";
    } else {
      return "image"; // Default fallback
    }
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];

    // Validate file type
    const supportedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/webm",
      "video/quicktime",
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/webm",
      "audio/mp4",
      "audio/aac",
      "audio/flac",
    ];

    if (!supportedTypes.includes(file.type)) {
      alert(
        "Unsupported file type. Please select an image, video, or audio file."
      );
      return;
    }

    // Reset file input
    event.target.value = "";

    createFileCardMutation.mutate({
      file,
      cardData: {
        metaInfo: {
          source: "File Upload",
          tags: [],
        },
      },
    });
  };

  const handleSave = () => {
    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    const { type, data } = detectCardType(trimmedContent);

    createCardMutation.mutate({
      type,
      data,
      metaInfo: {
        source: "Manual Entry",
        tags: [],
      },
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  if (isRecording) {
    return (
      <Card className="min-h-50 p-4 gap-4 flex flex-col items-center justify-center">
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-red-700">
                Recording...
              </span>
            </div>
            <span className="text-sm font-mono text-red-600">
              {formatDuration(recordingDuration)}
            </span>
          </div>
        </div>
        <Button
          variant="destructive"
          size="icon"
          type="button"
          onClick={stopRecording}
          title="Stop recording"
          className="mt-4"
        >
          <Square className="h-4 w-4" />
        </Button>
      </Card>
    );
  }

  return (
    <Card className="min-h-50 p-4 gap-4">
      <CardContent className="p-0 h-full">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter your bookmark, URL, or note... (⌘+Enter to save)"
          disabled={createCardMutation.isPending}
          className="min-h-[80px] resize-none h-full"
        />
      </CardContent>
      <CardContent className="p-0">
        {uploadProgress !== null && (
          <div className="mt-2">
            <div className="flex justify-between text-sm text-muted-foreground mb-1">
              <span>Uploading...</span>
              <span>{Math.round(uploadProgress)}%</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="p-0 flex justify-between">
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button
            variant="outline"
            size="icon"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={createFileCardMutation.isPending}
            title="Add file or image"
          >
            {createFileCardMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            type="button"
            onClick={handleAudioRecording}
            disabled={
              createFileCardMutation.isPending || uploadProgress !== null
            }
            title="Record audio"
          >
            <Mic className="h-4 w-4" />
          </Button>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!content.trim() || createCardMutation.isPending}
        >
          {createCardMutation.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <span>Save Card</span>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
