import { Action, ActionPanel, Icon, List, open } from "@raycast/api";
import { useEffect, useState } from "react";
import { CardDetail } from "./components/CardDetail";
import { MissingApiKeyDetail } from "./components/MissingApiKeyDetail";
import { SetRaycastKeyAction } from "./components/SetRaycastKeyAction";
import { type RaycastCard, searchCards } from "./lib/api";
import { getPreferences } from "./lib/preferences";

const TEAK_HOME = "https://app.teakvault.com";

const formatDate = (value: number): string =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(value);

export default function SearchCardsCommand() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<RaycastCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { apiKey } = getPreferences();
  const hasApiKey = Boolean(apiKey?.trim());

  useEffect(() => {
    if (!hasApiKey) {
      setItems([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    const timeout = setTimeout(async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await searchCards(query, 50);
        if (active) {
          setItems(response.items);
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Failed to fetch cards"
          );
          setItems([]);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [query, hasApiKey]);

  if (!hasApiKey) {
    return <MissingApiKeyDetail />;
  }

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="Search Teak cards"
      throttle
    >
      {error ? (
        <List.EmptyView icon={Icon.ExclamationMark} title={error} />
      ) : null}
      {items.map((card) => {
        const title =
          card.metadataTitle || card.content.slice(0, 70) || "Untitled";
        const subtitle =
          card.url || card.metadataDescription || card.notes || "";
        const targetUrl = card.url || TEAK_HOME;

        return (
          <List.Item
            accessories={[
              { text: formatDate(card.createdAt) },
              { tag: card.type },
            ]}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser title="Open" url={targetUrl} />
                <Action.Push
                  target={<CardDetail card={card} />}
                  title="View Details"
                />
                <Action.CopyToClipboard
                  content={card.content}
                  title="Copy Content"
                />
                {card.url ? (
                  <Action.CopyToClipboard content={card.url} title="Copy URL" />
                ) : null}
                <Action
                  icon={Icon.House}
                  onAction={() => open(TEAK_HOME)}
                  title="Open Teak"
                />
                <SetRaycastKeyAction />
              </ActionPanel>
            }
            icon={card.isFavorited ? Icon.Star : Icon.Document}
            key={card.id}
            subtitle={subtitle}
            title={title}
          />
        );
      })}
      {!(isLoading || error) && items.length === 0 ? (
        <List.EmptyView icon={Icon.MagnifyingGlass} title="No cards found" />
      ) : null}
    </List>
  );
}
