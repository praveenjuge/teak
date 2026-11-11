import type { TeakTranslator } from "@teak/i18n";
import { US_ENGLISH_LOCALE } from "@/lib/englishTranslators";
import { cardTitle, isFileCardType } from "../../lib/cardTypes";
import type { LinkTitleTranslator } from "../../lib/linkTitle";
import {
  type CardTypesTranslator,
  cardTypeLabel,
} from "../cards/cardTypeLabel";

export type CardHeadingTranslator = TeakTranslator<"cardModal.heading">;

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
    link,
    t,
    types,
  }: {
    link: LinkTitleTranslator;
    t: CardHeadingTranslator;
    types: CardTypesTranslator;
  }
): {
  editable: boolean;
  title: string;
} {
  const typeLabel = cardTypeLabel(card.type, types);
  if (card.type === "link") {
    return { editable: true, title: cardTitle(card, link) };
  }
  if (isFileCardType(card.type)) {
    return { editable: false, title: cardTitle(card, link) || typeLabel };
  }
  return {
    editable: false,
    title: card.type === "text" ? t("note") : typeLabel,
  };
}

export function formatAddedDate(
  timestamp: number,
  now: number,
  {
    locale = US_ENGLISH_LOCALE,
    t,
  }: { locale?: string; t: CardHeadingTranslator }
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
  // The time is part of the visible line: it's the only place a note's dialog
  // says when the card was added, so it has to reach touch and keyboard too.
  const time = saved.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (timestamp >= startOfToday) {
    return t("addedToday", { time });
  }
  if (timestamp >= startOfYesterday) {
    return t("addedYesterday", { time });
  }
  return t("addedOn", {
    time,
    date: saved.toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      ...(saved.getFullYear() === today.getFullYear()
        ? {}
        : { year: "numeric" }),
    }),
  });
}
