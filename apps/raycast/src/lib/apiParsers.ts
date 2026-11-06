import type {
  Card,
  CardLinkRef,
  CardListItem,
  CardsPage,
  CreateCardResponse,
  Folder,
  FolderCardsResult,
  TagOperation,
  TagSummary,
} from "teak-sdk";
import { RaycastApiError } from "./apiErrors";

export type { FolderCardsResult, TagSummary } from "teak-sdk";

export type RaycastCardLink = CardLinkRef;
export type RaycastLinkPrice = NonNullable<Card["linkPrice"]>;

/** The fields every card view reads; a list asks for them with its includes. */
const VIEW_FIELDS = [
  "aiSummary",
  "aiTags",
  "content",
  "createdAt",
  "fileUrl",
  "id",
  "isFavorited",
  "linkPreviewImageUrl",
  "metadataDescription",
  "metadataTitle",
  "notes",
  "screenshotUrl",
  "tags",
  "thumbnailUrl",
  "type",
  "updatedAt",
  "url",
] as const satisfies readonly (keyof Card)[];

type ViewField = (typeof VIEW_FIELDS)[number];

/** Fields newer servers send; a card from an older one leaves them out. */
type NewerField =
  | "aiTranscript"
  | "archivedAt"
  | "backlinks"
  | "colors"
  | "completedAt"
  | "fileName"
  | "fileSize"
  | "folderIds"
  | "isArchived"
  | "isDeleted"
  | "isHidden"
  | "linkAuthor"
  | "linkCategory"
  | "linkFacts"
  | "linkPrice"
  | "linkPublishedAt"
  | "linkPublisher"
  | "linkSiteName"
  | "links"
  | "mimeType"
  | "savedAt"
  | "sourceTitle"
  | "sourceUrl";

/** A card as Raycast shows it: the SDK's card, with what the views read. */
export type RaycastCard = Pick<Card, ViewField> &
  Partial<Pick<Card, NewerField>> & { appUrl: string | null };

export interface TagsResponse {
  items: TagSummary[];
}

export type SimilarityStatus = NonNullable<CardsPage["similarity"]>;

export interface CardsResponse {
  items: RaycastCard[];
  nextCursor: string | null;
  similarity?: SimilarityStatus;
  total: number;
}

export type RaycastFolder = Pick<
  Folder,
  "cardCount" | "color" | "id" | "kind" | "name" | "query"
>;

export interface FoldersResponse {
  items: RaycastFolder[];
}

export type RaycastTagOperation = Pick<
  TagOperation,
  "changed" | "error" | "id" | "kind" | "status" | "total"
>;

export type QuickSaveResponse = Omit<CreateCardResponse, "appUrl" | "card"> & {
  appUrl: string | null;
  card: RaycastCard | null;
};

const SIMILARITY_STATUSES: readonly string[] = ["ok", "pending", "unavailable"];

const hasViewFields = (card: CardListItem | Card): card is Card =>
  VIEW_FIELDS.every((field) => card[field] !== undefined);

/**
 * The card the SDK parsed, once it has every field the views read; a list
 * item without them (a list asked for fewer includes) is refused.
 */
export const parseRaycastCard = (card: CardListItem | Card): RaycastCard => {
  if (!hasViewFields(card)) {
    throw new RaycastApiError("REQUEST_FAILED");
  }
  return card;
};

export const parseCardsPageResponse = (page: CardsPage): CardsResponse => ({
  items: page.items.map(parseRaycastCard),
  nextCursor: page.pageInfo.nextCursor,
  similarity:
    page.similarity && SIMILARITY_STATUSES.includes(page.similarity)
      ? page.similarity
      : undefined,
  total: page.items.length,
});

export const parseTagsResponse = (tags: {
  items: TagSummary[];
}): TagsResponse => ({ items: tags.items });

const folderView = ({
  cardCount,
  color,
  id,
  kind,
  name,
  query,
}: Folder): RaycastFolder => ({ cardCount, color, id, kind, name, query });

export const parseFoldersResponse = (folders: {
  items: Folder[];
}): FoldersResponse => ({ items: folders.items.map(folderView) });

export const parseFolder = folderView;

export const parseFolderCardsResult = ({
  failedIds,
  folderLimitIds,
  updatedIds,
}: FolderCardsResult): FolderCardsResult => ({
  failedIds,
  folderLimitIds,
  updatedIds,
});

export const parseTagOperation = ({
  changed,
  error,
  id,
  kind,
  status,
  total,
}: TagOperation): RaycastTagOperation => ({
  changed,
  error,
  id,
  kind,
  status,
  total,
});

export const parseQuickSaveResponse = (
  response: CreateCardResponse,
): QuickSaveResponse => ({
  appUrl: response.appUrl,
  card: response.card ? parseRaycastCard(response.card) : null,
  cardId: response.cardId,
  status: response.status,
  ...(response.resaved === true ? { resaved: true as const } : {}),
  ...(response.resaved === true && response.wasArchived === true
    ? { wasArchived: true as const }
    : {}),
});

export const parseToolCardId = (value: unknown): string => {
  const cardId = typeof value === "string" ? value.trim() : "";
  if (!cardId) {
    throw new Error("cardId is required");
  }
  return cardId;
};
