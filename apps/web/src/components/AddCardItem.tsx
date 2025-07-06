import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { apiClient, type Card as CardType } from "@/lib/api";
import { Loader2, Mic, FileUp } from "lucide-react";

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
            onClick={() => {
              // TODO: Implement audio recording functionality
              console.log("Audio recording clicked");
            }}
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
