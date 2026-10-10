import { Action, ActionPanel, Icon } from "@raycast/api";
import type { RaycastCard } from "../lib/api";
import { getOpenableUrl, getTeakUrl } from "../lib/cardDetailModel";
import {
  applyFavoritedFilter,
  applyHueFilter,
  applySortFilter,
  applyTagFilter,
  applyTrashedFilter,
  applyTypeFilter,
  clearSearchFilters,
  HUE_OPTIONS,
  type ParsedSearchFilters,
  type RaycastCardType,
} from "../lib/searchFilters";
import {
  deleteCardForever,
  moveCardToTrash,
  restoreFromTrash,
} from "../lib/trashActions";
import { CardDetail } from "./CardDetail";
import { EditCardForm } from "./EditCardForm";
import { SetApiKeyAction } from "./SetApiKeyAction";
import { SignOutAction } from "./SignOutAction";

const TYPE_OPTIONS: Array<{ title: string; value?: RaycastCardType }> = [
  { title: "All Types" },
  { title: "Text", value: "text" },
  { title: "Links", value: "link" },
  { title: "Images", value: "image" },
  { title: "Videos", value: "video" },
  { title: "Audio", value: "audio" },
  { title: "Documents", value: "document" },
  { title: "Palettes", value: "palette" },
  { title: "Quotes", value: "quote" },
];

const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

export interface CardListActionsProps {
  card: RaycastCard;
  filters: ParsedSearchFilters;
  inTrash: boolean;
  onCardRemoved: (cardId: string) => void;
  onCardUpdated: (card: RaycastCard) => void;
  onFilterByTag: (tag: string) => void;
  onQueryChange: (update: (previous: string) => string) => void;
  onSignedOut: () => void;
  onToggleFavorite: (card: RaycastCard) => void;
  removeTagFilterFromList: boolean;
  showFavoritesFilter: boolean;
}

function FilterActions({
  card,
  filters,
  onQueryChange,
  removeTagFilterFromList,
  showFavoritesFilter,
}: Pick<
  CardListActionsProps,
  | "card"
  | "filters"
  | "onQueryChange"
  | "removeTagFilterFromList"
  | "showFavoritesFilter"
>) {
  const tagOptions = [...card.tags, ...card.aiTags].slice(0, 8);
  return (
    <ActionPanel.Section title="Filters">
      {showFavoritesFilter ? (
        <Action
          icon={Icon.Star}
          onAction={() =>
            onQueryChange((previous) =>
              applyFavoritedFilter(
                previous,
                filters.favorited ? undefined : true,
              ),
            )
          }
          title={filters.favorited ? "Show All Cards" : "Show Favorites Only"}
        />
      ) : null}
      <Action
        icon={Icon.Trash}
        onAction={() =>
          onQueryChange((previous) =>
            applyTrashedFilter(previous, filters.trashed ? undefined : true),
          )
        }
        shortcut={{ modifiers: ["cmd", "shift"], key: "t" }}
        title={filters.trashed ? "Leave Trash" : "Show Trash"}
      />
      <ActionPanel.Submenu icon={Icon.List} title="Filter by Type">
        {TYPE_OPTIONS.map((option) => (
          <Action
            key={option.title}
            onAction={() =>
              onQueryChange((previous) =>
                applyTypeFilter(previous, option.value),
              )
            }
            title={option.title}
          />
        ))}
      </ActionPanel.Submenu>
      <ActionPanel.Submenu icon={Icon.Swatch} title="Filter by Color">
        <Action
          onAction={() => onQueryChange((previous) => applyHueFilter(previous))}
          title="All Colors"
        />
        {HUE_OPTIONS.map((hue) => (
          <Action
            key={hue}
            onAction={() =>
              onQueryChange((previous) => applyHueFilter(previous, hue))
            }
            title={capitalize(hue)}
          />
        ))}
      </ActionPanel.Submenu>
      <ActionPanel.Submenu icon={Icon.ArrowUp} title="Sort Results">
        <Action
          onAction={() =>
            onQueryChange((previous) => applySortFilter(previous, "newest"))
          }
          title="Newest First"
        />
        <Action
          onAction={() =>
            onQueryChange((previous) => applySortFilter(previous, "oldest"))
          }
          title="Oldest First"
        />
      </ActionPanel.Submenu>
      {tagOptions.length > 0 && !removeTagFilterFromList ? (
        <ActionPanel.Submenu icon={Icon.Tag} title="Filter by Tag">
          {tagOptions.map((tag) => (
            <Action
              key={tag}
              onAction={() =>
                onQueryChange((previous) => applyTagFilter(previous, tag))
              }
              title={tag}
            />
          ))}
        </ActionPanel.Submenu>
      ) : null}
      {filters.hasExplicitFilters ? (
        <Action
          icon={Icon.XMarkCircle}
          onAction={() =>
            onQueryChange((previous) => clearSearchFilters(previous))
          }
          title="Clear Filters"
        />
      ) : null}
    </ActionPanel.Section>
  );
}

export function CardListActions(props: CardListActionsProps) {
  const {
    card,
    inTrash,
    onCardRemoved,
    onCardUpdated,
    onFilterByTag,
    onSignedOut,
    onToggleFavorite,
  } = props;
  const openableUrl = getOpenableUrl(card);
  return (
    <ActionPanel>
      <Action.Push
        icon={Icon.Eye}
        target={
          <CardDetail
            card={card}
            onCardDeleted={onCardRemoved}
            onCardUpdated={onCardUpdated}
            onFilterByTag={onFilterByTag}
            onNavigateBackAfterDelete={() => undefined}
          />
        }
        title="View Card"
      />
      {openableUrl ? (
        <Action.OpenInBrowser title="Open URL" url={openableUrl} />
      ) : null}
      {card.fileUrl ? (
        <Action.OpenInBrowser
          icon={Icon.Paperclip}
          title="Open File"
          url={card.fileUrl}
        />
      ) : null}
      <Action.OpenInBrowser title="Open in Teak" url={getTeakUrl(card)} />
      {inTrash ? (
        <ActionPanel.Section>
          <Action
            icon={Icon.ArrowCounterClockwise}
            onAction={() => void restoreFromTrash(card, onCardRemoved)}
            shortcut={{ modifiers: ["cmd", "shift"], key: "r" }}
            title="Restore"
          />
          <Action
            icon={Icon.Trash}
            onAction={() => void deleteCardForever(card, onCardRemoved)}
            shortcut={{ modifiers: ["ctrl"], key: "x" }}
            style={Action.Style.Destructive}
            title="Delete Forever"
          />
        </ActionPanel.Section>
      ) : (
        <ActionPanel.Section>
          <Action
            icon={Icon.Star}
            onAction={() => onToggleFavorite(card)}
            shortcut={{ modifiers: ["cmd"], key: "f" }}
            title={card.isFavorited ? "Remove Favorite" : "Add Favorite"}
          />
          <Action.Push
            icon={Icon.Pencil}
            shortcut={{ modifiers: ["cmd"], key: "e" }}
            target={<EditCardForm card={card} onCardUpdated={onCardUpdated} />}
            title="Edit Card"
          />
          <Action
            icon={Icon.Trash}
            onAction={() =>
              void moveCardToTrash(card, {
                onRemoved: onCardRemoved,
                onRestored: onCardUpdated,
              })
            }
            shortcut={{ modifiers: ["ctrl"], key: "x" }}
            style={Action.Style.Destructive}
            title="Move to Trash"
          />
        </ActionPanel.Section>
      )}
      <FilterActions
        card={card}
        filters={props.filters}
        onQueryChange={props.onQueryChange}
        removeTagFilterFromList={props.removeTagFilterFromList}
        showFavoritesFilter={props.showFavoritesFilter}
      />
      <ActionPanel.Section title="Copy">
        <Action.CopyToClipboard content={card.content} title="Copy Content" />
        {card.url ? (
          <Action.CopyToClipboard content={card.url} title="Copy URL" />
        ) : null}
        <Action.CopyToClipboard
          content={getTeakUrl(card)}
          title="Copy Teak Link"
        />
      </ActionPanel.Section>
      <SetApiKeyAction />
      <SignOutAction onSignedOut={onSignedOut} />
    </ActionPanel>
  );
}
