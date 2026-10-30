/**
 * Turns a Teak tool result into what the view shows. The result is the
 * tool's `structuredContent`: the public API's card JSON (see
 * packages/convex/publicApi/http/serializers.ts).
 */

export const CARD_TYPES = [
  "text",
  "link",
  "image",
  "video",
  "audio",
  "document",
  "palette",
  "quote",
] as const;

export type CardType = (typeof CARD_TYPES)[number];

export interface TeakCard {
  aiSummary: string | null;
  appUrl: string | null;
  colors: Array<{ hex: string; name?: string }>;
  content: string;
  fileName: string | null;
  id: string;
  imageUrl: string | null;
  isFavorited: boolean;
  notes: string | null;
  siteName: string | null;
  tags: string[];
  title: string | null;
  type: CardType;
  url: string | null;
}

export type ListSource = "favorites" | "recent" | "search";

export type CardView =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "list";
      cards: TeakCard[];
      query: string | null;
      source: ListSource;
    }
  | { kind: "card"; card: TeakCard }
  | { kind: "saved"; card: TeakCard; resaved: boolean };

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const httpUrl = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) {
    return null;
  }
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
};

const firstLine = (value: string): string | null => {
  const line = value
    .split("\n")
    .map((part) => part.replace(/^[#>*\-\s]+/u, "").trim())
    .find(Boolean);
  return line ? line.slice(0, 140) : null;
};

const hostOf = (url: string | null): string | null => {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return null;
  }
};

/** The title a card shows, the way the web app picks it, or null. */
const cardTitle = (card: JsonObject, type: CardType): string | null => {
  if (type === "link") {
    return (
      text(card.linkPreviewTitle) ??
      text(card.metadataTitle) ??
      hostOf(httpUrl(card.url))
    );
  }
  if (type === "image" || type === "video" || type === "audio") {
    return text(card.metadataTitle) ?? text(card.fileName);
  }
  if (type === "document") {
    return text(card.fileName) ?? text(card.metadataTitle);
  }
  if (type === "palette") {
    return text(card.metadataTitle);
  }
  return firstLine(typeof card.content === "string" ? card.content : "");
};

/** The first image Teak stored for a card; all of them are signed file URLs. */
const cardImage = (card: JsonObject, type: CardType): string | null =>
  httpUrl(card.thumbnailUrl) ??
  httpUrl(card.screenshotUrl) ??
  httpUrl(card.linkPreviewImageUrl) ??
  (type === "image" ? httpUrl(card.fileUrl) : null);

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export const toTeakCard = (value: unknown): TeakCard | null => {
  if (!(isObject(value) && typeof value.id === "string")) {
    return null;
  }
  const type = (CARD_TYPES as readonly unknown[]).includes(value.type)
    ? (value.type as CardType)
    : "text";
  const colors = Array.isArray(value.colors)
    ? value.colors.filter(
        (color): color is { hex: string; name?: string } =>
          isObject(color) &&
          typeof color.hex === "string" &&
          /^#[0-9a-f]{3,8}$/iu.test(color.hex)
      )
    : [];
  const url = httpUrl(value.url) ?? httpUrl(value.sourceUrl);
  return {
    aiSummary: text(value.aiSummary),
    appUrl: httpUrl(value.appUrl),
    colors,
    content: typeof value.content === "string" ? value.content : "",
    fileName: text(value.fileName),
    id: value.id,
    imageUrl: cardImage(value, type),
    isFavorited: value.isFavorited === true,
    notes: text(value.notes),
    siteName: text(value.linkSiteName) ?? hostOf(url),
    tags: [...new Set([...strings(value.tags), ...strings(value.aiTags)])],
    title: cardTitle(value, type),
    type,
    url,
  };
};

const listSourceFor = (toolName: string | undefined): ListSource => {
  if (toolName === "teak_v1_list_favorite_cards") {
    return "favorites";
  }
  if (toolName === "teak_v1_list_cards") {
    return "recent";
  }
  return "search";
};

/**
 * The view for one tool call: its name and input from the host, and the
 * result it returned.
 */
export const viewFromToolResult = ({
  input,
  result,
  toolName,
}: {
  input?: JsonObject;
  result: { isError?: boolean; structuredContent?: unknown };
  toolName?: string;
}): CardView => {
  const payload = result.structuredContent;
  if (result.isError || !isObject(payload)) {
    return { kind: "error" };
  }
  if (Array.isArray(payload.items)) {
    return {
      kind: "list",
      cards: payload.items
        .map(toTeakCard)
        .filter((card): card is TeakCard => card !== null),
      query: text(input?.q),
      source: listSourceFor(toolName),
    };
  }
  if (payload.status === "created" && isObject(payload.card)) {
    const card = toTeakCard({ appUrl: payload.appUrl, ...payload.card });
    return card
      ? { kind: "saved", card, resaved: payload.resaved === true }
      : { kind: "error" };
  }
  const card = toTeakCard(payload);
  return card ? { kind: "card", card } : { kind: "error" };
};
