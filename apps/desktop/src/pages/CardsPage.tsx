import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "@teak/convex";
import { usePaginatedQuery } from "convex-helpers/react/cache/hooks";
import { toast } from "sonner";
import { CardGrid } from "@/components/CardGrid";
import { EmptyState } from "@/components/EmptyState";
import { Spinner } from "@/components/ui/spinner";
import { getCardViewUrl } from "@/lib/web-urls";

const CARDS_BATCH_SIZE = 24;

export function CardsPage() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.cards.searchCardsPaginated,
    {},
    { initialNumItems: CARDS_BATCH_SIZE }
  );

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
      cards={cards}
      hasMore={hasMore}
      isLoadingMore={isLoadingMore}
      onCardClick={(card) => void handleCardClick(card._id)}
      onLoadMore={() => loadMore(CARDS_BATCH_SIZE)}
    />
  );
}
