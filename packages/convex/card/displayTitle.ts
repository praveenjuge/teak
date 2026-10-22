import type { Doc } from "../_generated/dataModel";
import { replaceCardLinkTokens } from "../shared/cardLinks";

const CONTENT_PREVIEW_LENGTH = 280;
const WWW_PREFIX = /^www\./;
const LINE_BREAK = /\r?\n/;

type TitledCard = Pick<
  Doc<"cards">,
  | "aiTranscript"
  | "aiTranscriptPreview"
  | "content"
  | "fileMetadata"
  | "metadata"
  | "metadataTitle"
  | "type"
  | "url"
>;

const compactText = (value?: string | null) => {
  const normalized = value?.trim();
  if (!normalized) {
    return;
  }
  return normalized.slice(0, CONTENT_PREVIEW_LENGTH);
};

const linkHostname = (url?: string): string | undefined => {
  if (!url) {
    return;
  }
  try {
    return new URL(url).hostname.replace(WWW_PREFIX, "") || undefined;
  } catch {
    return undefined;
  }
};

/**
 * The start of a card's text, with `[[…]]` links shown as their saved titles,
 * or as what `linkTitle` returns for each one.
 */
export const cardPreviewText = (
  card: TitledCard,
  linkTitle: (title: string, id: string) => string = (title) => title
): string | undefined =>
  compactText(
    card.type === "audio"
      ? (card.aiTranscriptPreview ?? card.aiTranscript)
      : replaceCardLinkTokens(card.content ?? "", linkTitle)
  );

/**
 * The title every surface shows for a card: its link preview title, its
 * title, its file name, its site, then its first line of text.
 */
export const cardDisplayTitle = (
  card: TitledCard,
  previewText = cardPreviewText(card)
): string => {
  const linkTitle =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview.title
      : undefined;
  return (
    linkTitle ||
    card.metadataTitle ||
    card.fileMetadata?.fileName ||
    (card.type === "link" ? linkHostname(card.url) : undefined) ||
    previewText?.split(LINE_BREAK, 1)[0] ||
    (card.type === "palette" ? "Color palette" : "Saved card")
  );
};
