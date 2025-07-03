import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiClient, type Card as CardType } from "@/lib/api";
import { Loader2 } from "lucide-react";

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
    <Card className="border-dashed">
      <CardContent className="h-full">
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
      <CardFooter>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!content.trim() || createCardMutation.isPending}
        >
          {createCardMutation.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <span>Save Card</span>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
