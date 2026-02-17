import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "@teak/convex";
import type { CardWithUrls } from "@teak/ui/cards";
import { Spinner } from "@teak/ui/components/ui/spinner";
import { EmptyState } from "@teak/ui/feedback/EmptyState";
import { useMutation } from "convex/react";
import { usePaginatedQuery } from "convex-helpers/react/cache/hooks";
import { toast } from "sonner";
import { CardGrid } from "@/components/CardGrid";
import { getCardViewUrl } from "@/lib/web-urls";

const CARDS_BATCH_SIZE = 24;

export function CardsPage() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.cards.searchCardsPaginated,
    {},
    { initialNumItems: CARDS_BATCH_SIZE }
  );

  const deleteCard = useMutation(api.cards.softDeleteCard);
  const toggleFavorite = useMutation(api.cards.toggleFavorite);

  const cards = results;
  const isLoadingFirstPage = status === "LoadingFirstPage";
  const isLoadingMore = status === "LoadingMore";
  const hasMore = status === "CanLoadMore";

  const handleCardClick = async (cardId: string) => {
    try {
      await openUrl(getCardViewUrl(cardId));
    } catch {
      toast.error("Unable to open card in browser");
    }
  };

  const handleDelete = async (cardId: string) => {
    try {
      await deleteCard({ cardId });
      toast.success("Card deleted");
    } catch {
      toast.error("Failed to delete card");
    }
  };

  const handleToggleFavorite = async (cardId: string) => {
    try {
      await toggleFavorite({ cardId });
    } catch {
      toast.error("Failed to update favorite");
    }
  };

  const handleAddTags = (_cardId: string) => {
    toast.info("Tags management coming soon");
  };

  if (isLoadingFirstPage) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  if (cards.length === 0) {
    return <EmptyState />;
  }

  return (
    <CardGrid
      cards={cards as CardWithUrls[]}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onAddTags={handleAddTags}
      onCardClick={(card) => void handleCardClick(card._id)}
      onDelete={(cardId) => void handleDelete(cardId)}
      onLoadMore={() => loadMore(CARDS_BATCH_SIZE)}
      onToggleFavorite={(cardId) => void handleToggleFavorite(cardId)}
    />
  );
}
