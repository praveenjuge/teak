import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import {
  englishTranslator,
  US_ENGLISH_LOCALE,
} from "../../lib/englishTranslators";
import {
  type ExifTranslator,
  formatExifFields,
  type ImageExif,
} from "../../lib/exif";
import { formatPublishedDate } from "../../lib/linkByline";
import { formatBytes } from "../settings/importExportFormat";

export type CardDetailsTranslator = TeakTranslator<"cardModal.details">;

const englishDetails: CardDetailsTranslator = createTeakTranslator(
  "en",
  englishMessages,
  "cardModal.details"
);

export function formatCardDate(
  timestamp: number,
  locale: string | undefined = US_ENGLISH_LOCALE
) {
  return new Date(timestamp).toLocaleDateString(locale, {
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
  /** When the card was last saved: `createdAt`, or later when the same link was saved again. */
  savedAt?: number;
  type?: string;
  updatedAt: number;
  url?: string;
}

const PROCESSING_WINDOW_MS = 60_000;

const editedAfterProcessing = (card: {
  createdAt: number;
  updatedAt: number;
}) => card.updatedAt - card.createdAt > PROCESSING_WINDOW_MS;

/** Saving a link you already have moves `savedAt` (and `updatedAt`) to now. */
const savedAgainAt = (card: { createdAt: number; savedAt?: number }) =>
  card.savedAt !== undefined &&
  card.savedAt - card.createdAt > PROCESSING_WINDOW_MS
    ? card.savedAt
    : undefined;

/** An edit date that is only the save again's own write isn't an edit. */
const editedAt = (card: {
  createdAt: number;
  savedAt?: number;
  updatedAt: number;
}) => {
  if (!editedAfterProcessing(card)) {
    return;
  }
  const savedAgain = savedAgainAt(card);
  if (
    savedAgain !== undefined &&
    Math.abs(card.updatedAt - savedAgain) <= PROCESSING_WINDOW_MS
  ) {
    return;
  }
  return card.updatedAt;
};

export interface CardDetailField {
  label: string;
  value: string;
}

const present = (fields: Array<{ label: string; value?: string | null }>) =>
  fields.filter((field): field is CardDetailField =>
    Boolean(field.value?.trim())
  );

/** The labels of the rows Details shows before "More details". */
export const keyDetailLabels = (t: CardDetailsTranslator = englishDetails) =>
  new Set([t("added"), t("savedAgain"), t("fileSize")]);

export function getCardDetailSections(
  card: CardDetailsSource,
  {
    exif = englishTranslator("lib.exif"),
    locale = US_ENGLISH_LOCALE,
    t = englishDetails,
  }: { exif?: ExifTranslator; locale?: string; t?: CardDetailsTranslator } = {}
) {
  const file = card.fileMetadata;
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const savedAgain = savedAgainAt(card);
  const edited = editedAt(card);
  return {
    details: present([
      { label: t("added"), value: formatCardDate(card.createdAt, locale) },
      {
        label: t("savedAgain"),
        value:
          savedAgain === undefined
            ? undefined
            : formatCardDate(savedAgain, locale),
      },
      {
        label: t("edited"),
        value:
          edited === undefined ? undefined : formatCardDate(edited, locale),
      },
      { label: t("fileName"), value: file?.fileName },
      {
        label: t("fileSize"),
        value: file?.fileSize ? formatBytes(file.fileSize, locale) : undefined,
      },
      { label: t("fileType"), value: file?.mimeType },
      {
        label: t("text"),
        value: card.extractedTextCharCount
          ? t("extractedText", { count: card.extractedTextCharCount })
          : undefined,
      },
    ]),
    source: present([
      { label: t("author"), value: linkPreview?.author },
      { label: t("publisher"), value: linkPreview?.publisher },
      {
        label: t("published"),
        value: formatPublishedDate(
          linkPreview?.publishedAt,
          Date.now(),
          locale
        ),
      },
    ]),
    camera:
      card.type === "image" ? formatExifFields(file?.exif, exif, locale) : [],
  };
}
