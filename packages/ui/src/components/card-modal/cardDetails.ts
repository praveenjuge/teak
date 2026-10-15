import { formatExifFields, type ImageExif } from "../../lib/exif";
import { formatPublishedDate } from "../../lib/linkByline";
import { formatBytes } from "../settings/importExportFormat";

export function formatCardDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface CardDetailsSource {
  content?: string;
  createdAt: number;
  /** Characters of text Teak extracted from the card's document. */
  extractedTextCharCount?: number;
  fileMetadata?: {
    exif?: ImageExif;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
  metadata?: {
    linkPreview?: {
      author?: string;
      publishedAt?: string;
      publisher?: string;
      status?: string;
    };
  };
  type?: string;
  updatedAt: number;
  url?: string;
}

const PROCESSING_WINDOW_MS = 60_000;

const editedAfterProcessing = (card: {
  createdAt: number;
  updatedAt: number;
}) => card.updatedAt - card.createdAt > PROCESSING_WINDOW_MS;

export interface CardDetailField {
  label: string;
  value: string;
}

const present = (fields: Array<{ label: string; value?: string | null }>) =>
  fields.filter((field): field is CardDetailField =>
    Boolean(field.value?.trim())
  );

/** The facts the card dialog's Details section lists, grouped as it shows them. */
export function getCardDetailSections(card: CardDetailsSource) {
  const file = card.fileMetadata;
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  return {
    details: present([
      { label: "Added", value: formatCardDate(card.createdAt) },
      {
        label: "Edited",
        value: editedAfterProcessing(card)
          ? formatCardDate(card.updatedAt)
          : undefined,
      },
      { label: "File name", value: file?.fileName },
      {
        label: "File size",
        value: file?.fileSize ? formatBytes(file.fileSize) : undefined,
      },
      { label: "File type", value: file?.mimeType },
      {
        label: "Text",
        value: card.extractedTextCharCount
          ? `${card.extractedTextCharCount.toLocaleString("en-US")} ${card.extractedTextCharCount === 1 ? "character" : "characters"} extracted`
          : undefined,
      },
    ]),
    source: present([
      { label: "Author", value: linkPreview?.author },
      { label: "Publisher", value: linkPreview?.publisher },
      {
        label: "Published",
        value: formatPublishedDate(linkPreview?.publishedAt),
      },
    ]),
    camera: card.type === "image" ? formatExifFields(file?.exif) : [],
  };
}
