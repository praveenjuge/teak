import {
  createTeakTranslator,
  englishMessages,
  type TeakTranslator,
} from "@teak/i18n";
import { US_ENGLISH_LOCALE } from "@/lib/englishTranslators";
import { resolveLinkTitle } from "../../lib/linkTitle";
import {
  type CardTypesTranslator,
  cardTypeLabel,
  englishCardTypes,
} from "../cards/cardTypeLabel";

export type CardHeadingTranslator = TeakTranslator<"cardModal.heading">;

const englishHeading: CardHeadingTranslator = createTeakTranslator(
  "en",
  englishMessages,
  "cardModal.heading"
);

interface HeadingSource {
  fileMetadata?: { fileName?: string };
  metadata?: { linkPreview?: { status?: string; title?: string } };
  metadataTitle?: string;
  metadataTitleEdited?: boolean;
  type?: string;
  url?: string;
}

export function getCardHeading(
  card: HeadingSource,
  {
    t = englishHeading,
    types = englishCardTypes,
  }: { t?: CardHeadingTranslator; types?: CardTypesTranslator } = {}
): {
  editable: boolean;
  title: string;
} {
  const typeLabel = cardTypeLabel(card.type, types);
  if (card.type === "link") {
    const preview =
      card.metadata?.linkPreview?.status === "success"
        ? card.metadata.linkPreview
        : undefined;
    return {
      editable: true,
      title: resolveLinkTitle({
        metadataTitle: card.metadataTitle,
        metadataTitleEdited: card.metadataTitleEdited,
        previewTitle: preview?.title,
        url: card.url,
      }),
    };
  }
  if (
    card.type === "image" ||
    card.type === "video" ||
    card.type === "audio" ||
    card.type === "document"
  ) {
    return {
      editable: false,
      title: card.metadataTitle || card.fileMetadata?.fileName || typeLabel,
    };
  }
  return {
    editable: false,
    title: card.type === "text" ? t("note") : typeLabel,
  };
}

export function formatAddedDate(
  timestamp: number,
  now = Date.now(),
  {
    locale = US_ENGLISH_LOCALE,
    t = englishHeading,
  }: { locale?: string; t?: CardHeadingTranslator } = {}
): string {
  const saved = new Date(timestamp);
  const today = new Date(now);
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime();
  // The local calendar day before, not 24 hours before: days around a
  // daylight saving change are 23 or 25 hours long.
  const startOfYesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1
  ).getTime();
  if (timestamp >= startOfToday) {
    return t("addedToday");
  }
  if (timestamp >= startOfYesterday) {
    return t("addedYesterday");
  }
  return t("addedOn", {
    date: saved.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      ...(saved.getFullYear() === today.getFullYear()
        ? {}
        : { year: "numeric" }),
    }),
  });
}
