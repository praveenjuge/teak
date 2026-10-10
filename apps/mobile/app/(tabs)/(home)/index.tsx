import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import {
  COLOR_HUE_BUCKETS,
  COLOR_HUE_LABELS,
  cardTypes,
} from "@teak/convex/shared/constants";
import { useMutation } from "convex/react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, PlatformColor } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { CardsGrid } from "@/components/CardsGrid";
import {
  triggerSuccessHaptic,
  triggerValidationErrorHaptic,
} from "@/lib/haptics";
import { useDebouncedValue } from "@/lib/hooks/useDebouncedValue";
import {
  CARD_TYPE_PLURALS,
  EMPTY_FILTERS,
  filtersTitle,
  hasActiveFilters,
  type LibraryFilters,
  toggleType,
} from "@/lib/library-filters";

const SEARCH_DEBOUNCE_MS = 250;
const DESTRUCTIVE_TINT = PlatformColor("systemRed");

interface SearchBarEvent {
  nativeEvent: {
    text: string;
  };
}

export default function HomeScreen() {
  const router = useRouter();
  const { q } = useLocalSearchParams<{ q?: string }>();
  const searchBarRef = useRef<SearchBarCommands>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string> | null>(null);
  const [isRunningBulkAction, setIsRunningBulkAction] = useState(false);
  const updateCardField = useMutation(api.cards.updateCardField);
  const permanentDeleteCard = useMutation(api.cards.permanentDeleteCard);
  const debouncedSearchQuery = useDebouncedValue(
    searchQuery,
    SEARCH_DEBOUNCE_MS
  );

  // A tag tapped in a card sheet arrives as ?q=tag, like clicking a tag on
  // the web: it searches for that tag.
  useEffect(() => {
    if (typeof q === "string" && q.trim()) {
      setSearchQuery(q);
      searchBarRef.current?.setText(q);
      router.setParams({ q: undefined });
    }
  }, [q, router]);

  const handleSearchChange = useCallback((event: SearchBarEvent) => {
    setSearchQuery(event.nativeEvent.text);
  }, []);

  const isSelecting = selectedIds !== null;
  const selectedCount = selectedIds?.size ?? 0;

  const beginSelection = useCallback((cardId?: string) => {
    setSelectedIds(new Set(cardId ? [cardId] : []));
  }, []);

  const toggleSelected = useCallback((cardId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current ?? []);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }, []);

  // Runs one action per selected card, like the web's bulk delete, then
  // reports any that failed.
  const runBulk = useCallback(
    async (action: (cardId: Id<"cards">) => Promise<unknown>) => {
      if (!selectedIds || selectedIds.size === 0 || isRunningBulkAction) {
        return;
      }
      setIsRunningBulkAction(true);
      let failed = 0;
      for (const cardId of selectedIds) {
        try {
          await action(cardId as Id<"cards">);
        } catch {
          failed += 1;
        }
      }
      setIsRunningBulkAction(false);
      setSelectedIds(null);
      if (failed > 0) {
        void triggerValidationErrorHaptic();
        Alert.alert(
          "Some cards didn't change",
          `${failed} of ${selectedIds.size} failed. Please try again.`
        );
      } else {
        void triggerSuccessHaptic();
      }
    },
    [isRunningBulkAction, selectedIds]
  );

  const deleteSelected = () =>
    runBulk((cardId) => updateCardField({ cardId, field: "delete" }));
  const restoreSelected = () =>
    runBulk((cardId) => updateCardField({ cardId, field: "restore" }));
  const confirmDeleteSelectedForever = () => {
    const noun = selectedCount === 1 ? "This card" : `${selectedCount} cards`;
    Alert.alert(
      "Delete Forever?",
      `${noun} and their files will be removed. You can't undo it.`,
      [
        { style: "cancel", text: "Cancel" },
        {
          onPress: () =>
            void runBulk((cardId) => permanentDeleteCard({ id: cardId })),
          style: "destructive",
          text: "Delete Forever",
        },
      ]
    );
  };

  let title = filtersTitle(filters);
  if (isSelecting) {
    title = selectedCount === 0 ? "Select Cards" : `${selectedCount} Selected`;
  }

  return (
    <>
      <Stack.Screen options={{ title, headerLargeTitle: true }} />
      <Stack.SearchBar
        autoCapitalize="none"
        hideWhenScrolling={false}
        onCancelButtonPress={() => setSearchQuery("")}
        onChangeText={handleSearchChange as any}
        placeholder="Search"
        ref={searchBarRef}
      />
      <Stack.Toolbar placement="right">
        {isSelecting ? (
          <Stack.Toolbar.Button
            accessibilityLabel="Done selecting"
            onPress={() => setSelectedIds(null)}
            variant="done"
          >
            Done
          </Stack.Toolbar.Button>
        ) : null}
        {isSelecting ? null : (
          <Stack.Toolbar.Button
            accessibilityLabel="Select cards"
            icon="checkmark.circle"
            onPress={() => beginSelection()}
          />
        )}
        {isSelecting ? null : (
          <Stack.Toolbar.Menu
            accessibilityLabel="Filter"
            icon={
              hasActiveFilters(filters)
                ? "line.3.horizontal.decrease.circle.fill"
                : "line.3.horizontal.decrease.circle"
            }
          >
            <Stack.Toolbar.MenuAction
              icon="heart"
              isOn={filters.favoritesOnly}
              onPress={() =>
                setFilters((current) => ({
                  ...current,
                  favoritesOnly: !current.favoritesOnly,
                }))
              }
            >
              Favorites
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.MenuAction
              icon="trash"
              isOn={filters.trashOnly}
              onPress={() =>
                setFilters((current) => ({
                  ...current,
                  trashOnly: !current.trashOnly,
                }))
              }
            >
              Trash
            </Stack.Toolbar.MenuAction>
            <Stack.Toolbar.Menu icon="square.grid.2x2" title="Type">
              {cardTypes.map((type) => (
                <Stack.Toolbar.MenuAction
                  isOn={filters.types.includes(type)}
                  key={type}
                  onPress={() =>
                    setFilters((current) => toggleType(current, type))
                  }
                >
                  {CARD_TYPE_PLURALS[type]}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.Menu icon="paintpalette" title="Color">
              {COLOR_HUE_BUCKETS.map((hue) => (
                <Stack.Toolbar.MenuAction
                  isOn={filters.hue === hue}
                  key={hue}
                  onPress={() =>
                    setFilters((current) => ({
                      ...current,
                      hue: current.hue === hue ? undefined : hue,
                    }))
                  }
                >
                  {COLOR_HUE_LABELS[hue]}
                </Stack.Toolbar.MenuAction>
              ))}
            </Stack.Toolbar.Menu>
            <Stack.Toolbar.MenuAction
              destructive
              hidden={!hasActiveFilters(filters)}
              icon="xmark.circle"
              onPress={() => setFilters(EMPTY_FILTERS)}
            >
              Clear Filters
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        )}
      </Stack.Toolbar>
      {isSelecting ? (
        <Stack.Toolbar>
          {filters.trashOnly ? (
            <Stack.Toolbar.Button
              disabled={selectedCount === 0 || isRunningBulkAction}
              icon="arrow.uturn.backward"
              onPress={() => void restoreSelected()}
            >
              Restore
            </Stack.Toolbar.Button>
          ) : null}
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.Button
            accessibilityLabel={
              filters.trashOnly ? "Delete forever" : "Move to Trash"
            }
            disabled={selectedCount === 0 || isRunningBulkAction}
            icon="trash"
            onPress={() =>
              filters.trashOnly
                ? confirmDeleteSelectedForever()
                : void deleteSelected()
            }
            tintColor={DESTRUCTIVE_TINT}
          />
        </Stack.Toolbar>
      ) : null}
      <CardsGrid
        filters={filters}
        onBeginSelection={beginSelection}
        searchQuery={debouncedSearchQuery}
        selection={
          selectedIds ? { ids: selectedIds, onToggle: toggleSelected } : null
        }
      />
    </>
  );
}
