import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import type { Card } from "@/lib/api";
import { CardItem } from "./CardItem";
import { EmptyState } from "./empty-state";
import Loading from "./loading";
import { AlertTriangle, Loader2, Search, Bookmark } from "lucide-react";
import { Button } from "./ui/button";
import { useSearch } from "@/contexts/SearchContext";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";

export function CardsGrid() {
  const { searchQuery, selectedType } = useSearch();
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);

  // Show if we're currently searching (user is typing but debounced value hasn't updated yet)
  const isSearching =
    searchQuery !== debouncedSearchQuery && searchQuery.trim().length > 0;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["cards", { searchQuery: debouncedSearchQuery, selectedType }],
    queryFn: () => {
      return apiClient.getCards({
        q: debouncedSearchQuery?.trim() || undefined,
        type: selectedType,
        sort: "created_at",
        order: "desc",
      });
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
  });

  if (isLoading || isSearching) {
    return <Loading />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <div className="text-center">
          <h3 className="text-lg font-semibold">Failed to load cards</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {error instanceof Error ? error.message : "Something went wrong"}
          </p>
        </div>
        <Button onClick={() => refetch()} variant="outline">
          <Loader2 className="h-4 w-4 mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  if (!data || data.cards.length === 0) {
    return (
      <EmptyState
        icon={debouncedSearchQuery ? Search : Bookmark}
        title={debouncedSearchQuery ? "No cards found" : "No cards yet"}
        description={
          debouncedSearchQuery
            ? `No cards match "${debouncedSearchQuery}"${selectedType ? ` in ${selectedType} cards` : ""}`
            : "Add your first bookmark, note, or media to get started."
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 my-6">
      {data.cards.map((card: Card) => (
        <CardItem key={card.id} card={card} onDelete={refetch} />
      ))}
    </div>
  );
}
