import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { useCardModal } from "../../hooks/useCardModal";
import {
  MoreInformationModal,
  NotesEditModal,
  TagManagementModal,
} from "../modals";
import { CardModal } from "./CardModal";
import type { CardModalCard } from "./types";

// Convex IDs are non-empty alphanumeric strings (with underscores).
// This rejects obviously malformed values like spaces, slashes, or empty strings.
const CONVEX_ID_PATTERN = /^[a-zA-Z0-9_]+$/;

interface ConnectedCardModalProps {
  card?: CardModalCard | null;
  cardId: string | null;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
  onInvalidCard?: () => void;
  onTagClick?: (tag: string) => void;
  onTagManagementOpenChange?: (open: boolean) => void;
  open: boolean;
  openTagManagement?: boolean;
}

export function ConnectedCardModal({
  cardId,
  card: cardData,
  open,
  onCancel,
  onCardTypeClick,
  onInvalidCard,
  onTagManagementOpenChange,
  onTagClick,
  openTagManagement = false,
}: ConnectedCardModalProps) {
  const [showTagManagementModal, setShowTagManagementModal] = useState(false);
  const [showMoreInfoModal, setShowMoreInfoModal] = useState(false);
  const [showNotesEditModal, setShowNotesEditModal] = useState(false);

  const isValidCardId = cardId ? CONVEX_ID_PATTERN.test(cardId) : false;

  const hydratedCard = useQuery(
    api.cards.getCard,
    cardId && !cardData && isValidCardId
      ? { id: cardId as Id<"cards"> }
      : "skip"
  );

  const resolvedCard = cardData ?? hydratedCard ?? null;

  const setTagManagementModalOpen = (nextOpen: boolean) => {
    setShowTagManagementModal(nextOpen);
    onTagManagementOpenChange?.(nextOpen);
  };

  const {
    card,
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
  } = useCardModal(cardId, { card: resolvedCard, onCardTypeClick });

  useEffect(() => {
    if (!(open && cardId && !cardData)) {
      return;
    }

    if (!isValidCardId) {
      onInvalidCard?.();
      return;
    }

    if (hydratedCard === null) {
      onInvalidCard?.();
    }
  }, [cardData, cardId, hydratedCard, isValidCardId, onInvalidCard, open]);

  useEffect(() => {
    if (open && openTagManagement) {
      setTagManagementModalOpen(true);
    }
    // Intentionally not depending on callback identity to avoid re-opening loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openTagManagement]);

  return (
    <CardModal
      card={card}
      downloadFile={downloadFile}
      getCurrentValue={getCurrentValue}
      handleDelete={handleDelete}
      handlePermanentDelete={handlePermanentDelete}
      handleRestore={handleRestore}
      hasUnsavedChanges={hasUnsavedChanges}
      MoreInformationModal={
        <MoreInformationModal
          card={card ?? null}
          onOpenChange={setShowMoreInfoModal}
          open={showMoreInfoModal}
        />
      }
      NotesEditModal={
        <NotesEditModal
          notes={getCurrentValue("notes") || ""}
          onCancel={() => {}}
          onOpenChange={setShowNotesEditModal}
          onSave={saveNotes}
          open={showNotesEditModal}
        />
      }
      onCancel={onCancel}
      onCardTypeClick={onCardTypeClick}
      onTagClick={onTagClick}
      open={open}
      openLink={openLink}
      saveChanges={saveChanges}
      setShowMoreInfoModal={setShowMoreInfoModal}
      setShowNotesEditModal={setShowNotesEditModal}
      setShowTagManagementModal={setTagManagementModalOpen}
      showMoreInfoModal={showMoreInfoModal}
      showNotesEditModal={showNotesEditModal}
      showTagManagementModal={showTagManagementModal}
      TagManagementModal={
        <TagManagementModal
          aiTags={card?.aiTags || []}
          onAddTag={addTag}
          onOpenChange={setTagManagementModalOpen}
          onRemoveAiTag={removeAiTag}
          onRemoveTag={removeTag}
          open={showTagManagementModal}
          setTagInput={setTagInput}
          tagInput={tagInput}
          userTags={card?.tags || []}
        />
      }
      toggleFavorite={toggleFavorite}
      updateContent={updateContent}
    />
  );
}
