import { CARD_TYPE_LABELS, type CardType } from "@teak/convex/shared/constants";
import { resolveLinkTitle } from "../../lib/linkTitle";

interface HeadingSource {
  fileMetadata?: { fileName?: string };
  metadata?: { linkPreview?: { status?: string; title?: string } };
  metadataTitle?: string;
  metadataTitleEdited?: boolean;
  type?: string;
  url?: string;
}

export function getCardHeading(card: HeadingSource): {
  editable: boolean;
  title: string;
} {
  const typeLabel = CARD_TYPE_LABELS[card.type as CardType] ?? "Card";
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
  return { editable: false, title: typeLabel === "Text" ? "Note" : typeLabel };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatAddedDate(timestamp: number, now = Date.now()): string {
  const saved = new Date(timestamp);
  const today = new Date(now);
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  ).getTime();
  if (timestamp >= startOfToday) {
    return "Added today";
  }
  if (timestamp >= startOfToday - DAY_MS) {
    return "Added yesterday";
  }
  return `Added ${saved.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(saved.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  })}`;
}
