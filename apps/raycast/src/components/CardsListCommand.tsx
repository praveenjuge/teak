import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type CardSearchInput,
  type CardsResponse,
  getUserFacingErrorMessage,
  type RaycastCard,
  setCardFavorite,
} from "../lib/api";
import { getCardTypeIcon } from "../lib/cardIcons";
import { getCardDomain, getCardTitle } from "../lib/cardDetailModel";
import { removeCardById, upsertCard } from "../lib/cardListState";
import {
  applyTagFilter,
  clearSearchFilters,
  parseSearchFilters,
} from "../lib/searchFilters";
import { useTeakAuth } from "../lib/useTeakAuth";
import { CardListActions } from "./CardListActions";
import { MissingApiKeyDetail } from "./MissingApiKeyDetail";
import { SetApiKeyAction } from "./SetApiKeyAction";
import { SignOutAction } from "./SignOutAction";

const PAGE_SIZE = 50;

interface CardsListCommandProps {
  emptyDescription: string;
  emptyIcon: Icon;
  emptyTitle: string;
  latestSectionTitle: string;
  loadCards: (input: CardSearchInput) => Promise<CardsResponse>;
  navigationTitle: string;
  removeTagFilterFromList?: boolean;
  removeUnfavoritedFromList?: boolean;
  searchBarPlaceholder: string;
}

const getCardSubtitle = (card: RaycastCard): string => {
  const domain = getCardDomain(card);
  if (card.type === "link") {
    return domain || card.metadataDescription || card.notes || card.url || "";
  }

  return (
    card.notes ||
    card.fileName ||
    card.metadataDescription ||
    card.url ||
    domain ||
    ""
  );
};

const getCardAccessories = (card: RaycastCard): List.Item.Accessory[] => {
  const accessories: List.Item.Accessory[] = [];

  if (card.tags[0]) {
    accessories.push({
      tag: {
        color: Color.Blue,
        value: card.tags[0],
      },
      tooltip: "First tag",
    });
  }

  if (card.isFavorited) {
    accessories.push({
      icon: { source: Icon.Star, tintColor: Color.Yellow },
      tooltip: "Favorited",
    });
  }

  accessories.push({
    date: new Date(card.createdAt),
    tooltip: "Created at",
  });

  return accessories;
};

export function CardsListCommand({
  emptyDescription,
  emptyIcon,
  emptyTitle,
  latestSectionTitle,
  loadCards,
  navigationTitle,
  removeTagFilterFromList = false,
  removeUnfavoritedFromList = false,
  searchBarPlaceholder,
}: CardsListCommandProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<RaycastCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Ignores pages that arrive after the filters changed.
  const requestGeneration = useRef(0);

  const {
    isAuthenticated,
    error: authError,
    isLoading: isCheckingAuth,
    refresh: refreshAuth,
  } = useTeakAuth();

  const parsedFilters = useMemo(() => parseSearchFilters(query), [query]);
  const requestInput = useMemo<CardSearchInput>(
    () => ({
      createdAfter: parsedFilters.createdAfter,
      createdBefore: parsedFilters.createdBefore,
      favorited:
        removeUnfavoritedFromList || parsedFilters.favorited ? true : undefined,
      hex: parsedFilters.hex,
      hue: parsedFilters.hue,
      limit: PAGE_SIZE,
      query: parsedFilters.query,
      sort: parsedFilters.sort,
      style: parsedFilters.style,
      tag: parsedFilters.tag,
      trashed: parsedFilters.trashed,
      type: parsedFilters.type,
    }),
    [parsedFilters, removeUnfavoritedFromList],
  );

  const load = useCallback(
    async (input: CardSearchInput) => {
      const generation = ++requestGeneration.current;
      setIsLoading(true);
      setError(null);

      try {
        const response = await loadCards(input);
        if (generation === requestGeneration.current) {
          setItems(response.items);
          setNextCursor(response.nextCursor);
        }
      } catch (requestError) {
        if (generation === requestGeneration.current) {
          setError(getUserFacingErrorMessage(requestError));
          setItems([]);
          setNextCursor(null);
        }
      } finally {
        if (generation === requestGeneration.current) {
          setIsLoading(false);
        }
      }
    },
    [loadCards],
  );

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoading) {
      return;
    }
    const generation = requestGeneration.current;
    setIsLoading(true);
    try {
      const response = await loadCards({ ...requestInput, cursor: nextCursor });
      if (generation === requestGeneration.current) {
        setItems((previous) => {
          const seen = new Set(previous.map((card) => card.id));
          return [
            ...previous,
            ...response.items.filter((card) => !seen.has(card.id)),
          ];
        });
        setNextCursor(response.nextCursor);
      }
    } catch (requestError) {
      if (generation === requestGeneration.current) {
        setError(getUserFacingErrorMessage(requestError));
      }
    } finally {
      if (generation === requestGeneration.current) {
        setIsLoading(false);
      }
    }
  }, [isLoading, loadCards, nextCursor, requestInput]);

  useEffect(() => {
    if (isCheckingAuth) {
      return;
    }

    if (!isAuthenticated) {
      setItems([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    void load(requestInput);
  }, [isCheckingAuth, isAuthenticated, load, requestInput]);

  const handleCardUpdated = useCallback(
    (next: RaycastCard) => {
      setItems((previous) =>
        upsertCard(previous, next, {
          removeWhenUnfavorited: removeUnfavoritedFromList,
        }),
      );
    },
    [removeUnfavoritedFromList],
  );

  const handleCardRemoved = useCallback((cardId: string) => {
    setItems((previous) => removeCardById(previous, cardId).cards);
  }, []);

  const handleFilterByTag = useCallback((tag: string) => {
    setQuery((previous) => applyTagFilter(previous, tag));
  }, []);

  const handleToggleFavorite = useCallback(
    async (card: RaycastCard) => {
      const previousState = card.isFavorited;
      handleCardUpdated({ ...card, isFavorited: !previousState });

      try {
        handleCardUpdated(await setCardFavorite(card.id, !previousState));
      } catch {
        handleCardUpdated(card);
      }
    },
    [handleCardUpdated],
  );

  if (isCheckingAuth) {
    return <List isLoading navigationTitle={navigationTitle} />;
  }

  if (!isAuthenticated) {
    return <MissingApiKeyDetail error={authError} onSignedIn={refreshAuth} />;
  }

  const inTrash = Boolean(parsedFilters.trashed);
  const isFiltered = Boolean(parsedFilters.rawQuery.trim());
  let title = isFiltered ? navigationTitle : latestSectionTitle;
  let empty = isFiltered
    ? {
        description: "Try a different keyword or clear your filters.",
        icon: emptyIcon,
        title: "No matching cards",
      }
    : { description: emptyDescription, icon: emptyIcon, title: emptyTitle };
  if (inTrash) {
    title = "Trash";
    empty = {
      description: "Cards you move to Trash show up here for 30 days.",
      icon: Icon.Trash,
      title: "Trash is empty",
    };
  }

  return (
    <List
      isLoading={isLoading}
      navigationTitle={title}
      onSearchTextChange={setQuery}
      pagination={{
        hasMore: Boolean(nextCursor),
        onLoadMore: () => void loadMore(),
        pageSize: PAGE_SIZE,
      }}
      searchBarPlaceholder={searchBarPlaceholder}
      searchText={query}
      throttle
    >
      {error ? (
        <List.EmptyView
          actions={
            <ActionPanel>
              <Action
                icon={Icon.ArrowClockwise}
                onAction={() => {
                  void load(requestInput);
                }}
                title="Retry"
              />
              {parsedFilters.hasExplicitFilters ? (
                <Action
                  icon={Icon.XMarkCircle}
                  onAction={() => {
                    setQuery((previous) => clearSearchFilters(previous));
                  }}
                  title="Clear Filters"
                />
              ) : null}
              <SetApiKeyAction />
              <SignOutAction onSignedOut={refreshAuth} />
            </ActionPanel>
          }
          description="Check your API key and network connection, then retry."
          icon={Icon.ExclamationMark}
          title={error}
        />
      ) : null}

      <List.Section
        subtitle={inTrash ? "Teak empties Trash after 30 days" : undefined}
        title={inTrash ? "Trash" : undefined}
      >
        {items.map((card) => (
          <List.Item
            accessories={getCardAccessories(card)}
            actions={
              <CardListActions
                card={card}
                filters={parsedFilters}
                inTrash={inTrash}
                onCardRemoved={handleCardRemoved}
                onCardUpdated={handleCardUpdated}
                onFilterByTag={handleFilterByTag}
                onQueryChange={setQuery}
                onSignedOut={refreshAuth}
                onToggleFavorite={(next) => void handleToggleFavorite(next)}
                removeTagFilterFromList={removeTagFilterFromList}
                showFavoritesFilter={!removeUnfavoritedFromList}
              />
            }
            icon={getCardTypeIcon(card)}
            key={card.id}
            subtitle={getCardSubtitle(card)}
            title={getCardTitle(card)}
          />
        ))}
      </List.Section>

      {!(isLoading || error) && items.length === 0 ? (
        <List.EmptyView
          description={empty.description}
          icon={empty.icon}
          title={empty.title}
        />
      ) : null}
    </List>
  );
}
