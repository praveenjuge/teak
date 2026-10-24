import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import { formatExifFields, type ImageExif } from "../../lib/exif";
import { formatPublishedDate } from "../../lib/linkByline";
import { formatBytes } from "../settings/importExportFormat";

/**
 * The locale the card dialog formatted dates with before translation.
 * English keeps it; pass it to `useIntlLocale` for the reader's language.
 */
// biome-ignore lint/plugin: the English default that useIntlLocale keeps, not a fixed locale for every language.
export const ENGLISH_DATE_LOCALE = "en-US";

export type CardDetailsTranslator = TeakTranslator<"cardModal.details">;

const englishDetails: CardDetailsTranslator = createTeakTranslator(
  "en",
  englishMessages,
  "cardModal.details"
);

export function formatCardDate(
  timestamp: number,
  locale: string | undefined = ENGLISH_DATE_LOCALE
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

/** The labels of the rows Details shows before "More details". */
export const keyDetailLabels = (t: CardDetailsTranslator = englishDetails) =>
  new Set([t("added"), t("fileSize")]);

export function getCardDetailSections(
  card: CardDetailsSource,
  {
    locale = ENGLISH_DATE_LOCALE,
    t = englishDetails,
  }: { locale?: string; t?: CardDetailsTranslator } = {}
) {
  const file = card.fileMetadata;
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  return {
    details: present([
      { label: t("added"), value: formatCardDate(card.createdAt, locale) },
      {
        label: t("edited"),
        value: editedAfterProcessing(card)
          ? formatCardDate(card.updatedAt, locale)
          : undefined,
      },
      { label: t("fileName"), value: file?.fileName },
      {
        label: t("fileSize"),
        value: file?.fileSize ? formatBytes(file.fileSize) : undefined,
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
        value: formatPublishedDate(linkPreview?.publishedAt),
      },
    ]),
    camera: card.type === "image" ? formatExifFields(file?.exif) : [],
  };
}
