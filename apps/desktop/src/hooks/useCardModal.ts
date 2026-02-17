import { api } from "@teak/convex";
import type { Doc, Id } from "@teak/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

interface PendingChanges {
  content?: string;
  isFavorited?: boolean;
  notes?: string;
}

type CardData = Pick<
  Doc<"cards">,
  "tags" | "content" | "notes" | "aiSummary" | "url"
> | null;

export interface UseCardModalOptions {
  card?: CardData;
  onOpenLink?: (url: string) => void;
}

export function useCardModal(
  cardId: string | null,
  options: UseCardModalOptions = {}
) {
  const { card, onOpenLink } = options;
  const [pendingChanges, setPendingChanges] = useState<PendingChanges>({});
  const [tagInput, setTagInput] = useState("");

  const updateCardField = useMutation(api.cards.updateCardField);
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);

  const hasUnsavedChanges = useMemo(() => {
    if (!card) return false;
    return Object.keys(pendingChanges).some((key) => {
      if (key === "isFavorited") return false;
      const pendingValue = pendingChanges[key as keyof PendingChanges];
      const currentValue = card[key as keyof typeof card];
      return pendingValue !== undefined && pendingValue !== currentValue;
    });
  }, [card, pendingChanges]);

  const getCurrentValue = useCallback(
    (field: "content" | "url" | "notes" | "aiSummary"): string | undefined => {
      if (field === "content" || field === "notes") {
        const pending = pendingChanges[field];
        if (typeof pending === "string") {
          return pending;
        }
      }
      const cardValue = card?.[field as keyof CardData];
      return typeof cardValue === "string" ? cardValue : undefined;
    },
    [card, pendingChanges]
  );

  const updateContent = useCallback((content: string) => {
    setPendingChanges((prev) => ({ ...prev, content }));
  }, []);

  const saveChanges = useCallback(async () => {
    if (!(cardId && hasUnsavedChanges)) return;

    const updates = Object.entries(pendingChanges)
      .filter(
        ([field, value]) => value !== undefined && field !== "isFavorited"
      )
      .map(([field, value]) => ({ field, value }));

    try {
      for (const { field, value } of updates) {
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: field as "content" | "notes",
          value,
        });
      }
      setPendingChanges({});
      toast.success("Changes saved");
    } catch (error) {
      console.error("Failed to save changes:", error);
      toast.error("Failed to save changes");
    }
  }, [cardId, hasUnsavedChanges, pendingChanges, updateCardField]);

  const toggleFavorite = useCallback(async () => {
    if (!cardId) return;
    try {
      await updateCardField({
        cardId: cardId as Id<"cards">,
        field: "isFavorited",
      });
    } catch (error) {
      console.error("Failed to toggle favorite:", error);
      toast.error("Failed to update favorite");
    }
  }, [cardId, updateCardField]);

  const addTag = useCallback(async () => {
    if (!(cardId && tagInput.trim())) return;
    try {
      const currentTags = card?.tags || [];
      const newTag = tagInput.trim().toLowerCase();
      if (currentTags.includes(newTag)) {
        toast.error("Tag already exists");
        return;
      }
      await updateCardField({
        cardId: cardId as Id<"cards">,
        field: "tags",
        value: [...currentTags, newTag],
      });
      setTagInput("");
      toast.success("Tag added");
    } catch (error) {
      console.error("Failed to add tag:", error);
      toast.error("Failed to add tag");
    }
  }, [card?.tags, cardId, tagInput, updateCardField]);

  const removeTag = useCallback(
    async (tagToRemove: string) => {
      if (!cardId) return;
      try {
        const currentTags = card?.tags || [];
        const newTags = currentTags.filter((tag) => tag !== tagToRemove);
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: "tags",
          value: newTags.length > 0 ? newTags : undefined,
        });
        toast.success("Tag removed");
      } catch (error) {
        console.error("Failed to remove tag:", error);
        toast.error("Failed to remove tag");
      }
    },
    [card?.tags, cardId, updateCardField]
  );

  const removeAiTag = useCallback(
    async (tagToRemove: string) => {
      if (!cardId) return;
      try {
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: "removeAiTag",
          tagToRemove,
        });
      } catch (error) {
        console.error("Failed to remove AI tag:", error);
        toast.error("Failed to remove AI tag");
      }
    },
    [cardId, updateCardField]
  );

  const handleDelete = useCallback(
    async (onClose?: () => void) => {
      if (!cardId) return;
      try {
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: "delete",
        });
        toast.success("Card deleted");
        onClose?.();
      } catch (error) {
        console.error("Failed to delete card:", error);
        toast.error("Failed to delete card");
      }
    },
    [cardId, updateCardField]
  );

  const handleRestore = useCallback(
    async (onClose?: () => void) => {
      if (!cardId) return;
      try {
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: "restore",
        });
        toast.success("Card restored");
        onClose?.();
      } catch (error) {
        console.error("Failed to restore card:", error);
        toast.error("Failed to restore card");
      }
    },
    [cardId, updateCardField]
  );

  const handlePermanentDelete = useCallback(
    async (onClose?: () => void) => {
      if (!cardId) return;
      try {
        await permanentDeleteCard({ id: cardId as Id<"cards"> });
        toast.success("Card permanently deleted");
        onClose?.();
      } catch (error) {
        console.error("Failed to permanently delete card:", error);
        toast.error("Failed to permanently delete card");
      }
    },
    [cardId, permanentDeleteCard]
  );

  const downloadFile = useCallback(() => {
    toast.info("Download coming soon");
  }, []);

  const saveNotes = useCallback(
    async (notes: string): Promise<boolean> => {
      if (!cardId) return false;
      try {
        await updateCardField({
          cardId: cardId as Id<"cards">,
          field: "notes",
          value: notes,
        });
        toast.success("Notes saved");
        return true;
      } catch (error) {
        console.error("Failed to save notes:", error);
        toast.error("Failed to save notes");
        return false;
      }
    },
    [cardId, updateCardField]
  );

  const openLink = useCallback(() => {
    const url = card?.url;
    if (!url) return;
    if (onOpenLink) {
      onOpenLink(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [card?.url, onOpenLink]);

  return {
    tagInput,
    setTagInput,
    updateContent,
    toggleFavorite,
    addTag,
    removeTag,
    removeAiTag,
    handleDelete,
    handleRestore,
    handlePermanentDelete,
    openLink,
    downloadFile,
    saveChanges,
    saveNotes,
    hasUnsavedChanges,
    getCurrentValue,
  };
}
