import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Masonry } from "masonic";
import { apiClient } from "@/lib/api";
import type { Card } from "@/lib/api";
import { CardItem } from "./CardItem";
import { AddCardItem } from "./AddCardItem";
import { EmptyState } from "./empty-state";
import { CardsGridSkeleton } from "./CardSkeleton";
import { AlertTriangle, Search } from "lucide-react";
import { useSearch } from "@/contexts/SearchContext";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import { useCallback, useMemo } from "react";

// Create the masonry render component
interface MasonryItemData {
  type: "card" | "add";
  card?: Card;
  onDelete?: () => void;
}

const MasonryItem = ({
  data,
  width,
}: {
  data: MasonryItemData;
  width: number;
}) => {
  if (data?.type === "add") {
    return (
      <div style={{ width }}>
        <AddCardItem />
      </div>
    );
  }

  if (data?.card) {
    return (
      <div style={{ width }}>
        <CardItem card={data.card} onDelete={data.onDelete} />
      </div>
    );
  }
  // Return an empty div instead of null to avoid WeakMap issues
  return <div style={{ width, height: 0 }} />;
};

export function CardsGrid() {
  const { searchQuery, selectedType } = useSearch();
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 200);
  const queryClient = useQueryClient();

  const { data, error, isLoading } = useQuery({
    queryKey: ["cards", { searchQuery: debouncedSearchQuery, selectedType }],
    queryFn: () => {
      return apiClient.getCards({
        q: debouncedSearchQuery?.trim() || undefined,
        type: selectedType,
        sort: "created_at",
        order: "desc",
        limit: 100,
      });
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
  });

  // Memoized callback for handling card deletion
  const handleCardDelete = useCallback(() => {
    // Invalidate the cards query to refresh the grid
    queryClient.invalidateQueries({ queryKey: ["cards"] });
  }, [queryClient]);

  if (isLoading) {
    return <CardsGridSkeleton />;
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Failed to load cards"
        description={
          error instanceof Error ? error.message : "Something went wrong"
        }
        action={{
          label: "Try Again",
          onClick: () => {
            // Invalidate queries to retry loading
            queryClient.invalidateQueries({ queryKey: ["cards"] });
          },
        }}
      />
    );
  }

  if (!data || data.cards.length === 0) {
    // When searching and no results found, show empty state
    if (debouncedSearchQuery) {
      return (
        <EmptyState
          icon={Search}
          title="No cards found"
          description={`No cards match "${debouncedSearchQuery}"${selectedType ? ` in ${selectedType} cards` : ""}`}
        />
      );
    }

    // When not searching and no cards exist, show just the AddCardItem
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        <AddCardItem />
      </div>
    );
  }

  // Prepare masonry items with memoization to ensure proper re-rendering
  const masonryItems: MasonryItemData[] = useMemo(() => {
    const items: MasonryItemData[] = [];

    // Add the AddCardItem only when not searching
    if (!debouncedSearchQuery) {
      items.push({ type: "add" });
    }

    // Add all cards
    data.cards.forEach((card: Card) => {
      // Only add valid card objects to prevent WeakMap errors
      if (card && card.id) {
        items.push({ type: "card", card, onDelete: handleCardDelete });
      }
    });

    return items;
  }, [data.cards, debouncedSearchQuery, handleCardDelete]);

  return (
    <Masonry
      key={`${data.cards.length}-${debouncedSearchQuery || "all"}-${selectedType || "all"}`}
      items={masonryItems}
      render={MasonryItem}
      columnGutter={24}
      rowGutter={24}
      columnWidth={264}
      maxColumnCount={5}
      itemKey={(item, index) =>
        item?.type === "add" ? "add-card" : item?.card?.id || `item-${index}`
      }
    />
  );
}
