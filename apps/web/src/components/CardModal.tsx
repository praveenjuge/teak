import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import type { CardModalCard } from "@teak/ui/card-modal";
import { CardModal as SharedCardModal } from "@teak/ui/card-modal";
import { useCardModal } from "@teak/ui/hooks";
import {
  MoreInformationModal,
  NotesEditModal,
  TagManagementModal,
} from "@teak/ui/modals";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";

// Convex IDs are non-empty alphanumeric strings (with underscores).
// This rejects obviously malformed values like spaces, slashes, or empty strings.
const CONVEX_ID_PATTERN = /^[a-zA-Z0-9_]+$/;

interface CardModalProps {
  card?: CardModalCard | null;
  cardId: string | null;
  onCancel?: () => void;
  onCardTypeClick?: (cardType: string) => void;
  onInvalidCard?: () => void;
  onTagClick?: (tag: string) => void;
  open: boolean;
}

export function CardModal({
  cardId,
  card: cardData,
  open,
  onCancel,
  onCardTypeClick,
  onInvalidCard,
  onTagClick,
}: CardModalProps) {
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
    if (cardId && !cardData) {
      // Invalid format — fire immediately without waiting for a query
      if (!isValidCardId) {
        onInvalidCard?.();
        return;
      }
      // Valid format but query resolved to null (not found / unauthorized)
      if (hydratedCard === null) {
        onInvalidCard?.();
      }
    }
  }, [cardData, cardId, hydratedCard, isValidCardId, onInvalidCard]);

  return (
    <SharedCardModal
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
      setShowTagManagementModal={setShowTagManagementModal}
      showMoreInfoModal={showMoreInfoModal}
      showNotesEditModal={showNotesEditModal}
      showTagManagementModal={showTagManagementModal}
      TagManagementModal={
        <TagManagementModal
          aiTags={card?.aiTags || []}
          onAddTag={addTag}
          onOpenChange={setShowTagManagementModal}
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
