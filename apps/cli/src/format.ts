import { formatLinkPrice } from "@teak/convex/shared/price";
import { formatBytes } from "@teak/convex/shared/utils/formatBytes";
import type { Card, CardLinkRef, CardLinks } from "teak-sdk";
import { plainOutput } from "./mode";

const relativeAge = (ms: number) => {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
};

type CardLineInput =
  | Card
  | {
      content?: string;
      createdAt: number;
      id: string;
      isHidden?: boolean;
      tags?: string[];
      type: string;
    };

/**
 * One card per line. For a person: id, type, a 54-character snippet, up to
 * four tags and its age, aligned. For a pipe (`plain`): the same fields in
 * full, tab-separated, with the creation time in ISO UTC, so `cut -f` works.
 */
export const formatCardLine = (card: CardLineInput, plain = false) => {
  const text = (card.content || "").replace(/\s+/g, " ").trim();
  if (plain) {
    return [
      card.id,
      card.type,
      text,
      (card.tags || []).join(","),
      new Date(card.createdAt).toISOString(),
      card.isHidden ? "hidden" : "",
    ].join("\t");
  }
  const snippet =
    text.length > 54
      ? `${text.slice(0, 53)}...`
      : text.padEnd(Math.min(54, Math.max(10, text.length)));
  const tags = (card.tags || [])
    .slice(0, 4)
    .map((tag) => `#${tag}`)
    .join(" ");
  const age = relativeAge(Date.now() - card.createdAt);
  const hidden = card.isHidden ? "  hidden" : "";
  return `${card.id}  ${card.type.padEnd(8)}  ${snippet}  ${tags}  ${age}${hidden}`.trim();
};

/** Card lines in the shape stdout needs: aligned for a terminal, tabs for a pipe. */
export const formatCardLines = (cards: CardLineInput[]) =>
  cards.map((card) => formatCardLine(card, plainOutput())).join("\n");

const SNIPPET_CHARS = 54;

const cardCells = (card: CardLineInput) => {
  const text = (card.content || "").replace(/\s+/g, " ").trim();
  return [
    card.id,
    card.type,
    text.length > SNIPPET_CHARS
      ? `${text.slice(0, SNIPPET_CHARS - 1)}...`
      : text,
    (card.tags || [])
      .slice(0, 4)
      .map((tag) => `#${tag}`)
      .join(" "),
    `${relativeAge(Date.now() - card.createdAt)}${card.isHidden ? " hidden" : ""}`,
  ];
};

const CARD_HEADERS = ["ID", "Type", "Content", "Tags", "Age"];

/**
 * A listing for a person: a header row, then one card per row in aligned
 * columns. A pipe (`plain`) gets the tab-separated lines with no header.
 */
export const formatCardTable = (
  cards: CardLineInput[],
  plain = plainOutput()
) => {
  if (plain) {
    return cards.map((card) => formatCardLine(card, true)).join("\n");
  }
  const rows = [CARD_HEADERS, ...cards.map(cardCells)];
  const widths = CARD_HEADERS.map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? "").length))
  );
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)
        )
        .join("  ")
        .trimEnd()
    )
    .join("\n");
};

const TRANSCRIPT_PREVIEW_CHARS = 600;

const fileLine = (card: Card) => {
  if (!card.fileName) {
    return null;
  }
  const size = card.fileSize ? ` (${formatBytes(card.fileSize)})` : "";
  return `file: ${card.fileName}${size}`;
};

const transcriptBlock = (transcript: string | null | undefined) => {
  if (!transcript?.trim()) {
    return [];
  }
  const text = transcript.trim();
  return [
    "",
    "Transcript:",
    text.length > TRANSCRIPT_PREVIEW_CHARS
      ? `${text.slice(0, TRANSCRIPT_PREVIEW_CHARS)}… (full text with --json)`
      : text,
  ];
};

const SAVED_AGAIN_AFTER_MS = 60_000;

const savedAgainLine = (card: { createdAt: number; savedAt?: number }) =>
  card.savedAt !== undefined &&
  card.savedAt - card.createdAt > SAVED_AGAIN_AFTER_MS
    ? `saved again: ${new Date(card.savedAt).toISOString()}`
    : null;

export const formatCreated = (result: {
  appUrl: string;
  cardId: string;
  resaved?: boolean;
  wasArchived?: boolean;
}) =>
  result.resaved
    ? `Already in Teak, moved to the top${result.wasArchived ? " and out of Archive" : ""}: ${result.cardId}  ${result.appUrl}`
    : `${result.cardId}  ${result.appUrl}`;

export const formatDetail = (card: Card) =>
  [
    `id: ${card.id}`,
    `type: ${card.type}`,
    card.metadataTitle ? `title: ${card.metadataTitle}` : null,
    `created: ${new Date(card.createdAt).toISOString()}`,
    savedAgainLine(card),
    `updated: ${new Date(card.updatedAt).toISOString()}`,
    card.isFavorited ? "favorite: yes" : null,
    card.isPinned ? "pinned: yes" : null,
    card.completedAt
      ? `done: ${new Date(card.completedAt).toISOString()}`
      : null,
    card.isHidden ? "hidden: yes (search #secret or #hidden)" : null,
    card.isDeleted ? "in trash: yes" : null,
    card.url ? `url: ${card.url}` : null,
    card.sourceUrl
      ? `from: ${card.sourceTitle ? `${card.sourceTitle} <${card.sourceUrl}>` : card.sourceUrl}`
      : null,
    card.linkPrice
      ? `price: ${formatLinkPrice(
          {
            amount: card.linkPrice.amount,
            currency: card.linkPrice.currency ?? undefined,
          },
          "en-US"
        )}`
      : null,
    fileLine(card),
    card.notes ? `notes: ${card.notes}` : null,
    card.tags.length ? `tags: ${card.tags.join(", ")}` : null,
    card.aiTags.length ? `ai tags: ${card.aiTags.join(", ")}` : null,
    card.colors.length
      ? `colors: ${card.colors.map((color) => color.hex).join(" ")}`
      : null,
    card.aiSummary ? `summary: ${card.aiSummary}` : null,
    `open: ${card.appUrl}`,
    "",
    card.content,
    ...transcriptBlock(card.aiTranscript),
  ]
    .filter((line) => line !== null)
    .join("\n");

const linkLine = (link: CardLinkRef) =>
  link.missing
    ? `${link.id}  (missing)`
    : `${link.id}  ${(link.type ?? "").padEnd(8)}  ${link.title ?? ""}`.trimEnd();

export const formatCardLinks = (links: CardLinks) => {
  if (links.links.length === 0 && links.backlinks.length === 0) {
    return "No links.";
  }
  const section = (title: string, items: CardLinkRef[], truncated: boolean) =>
    items.length === 0
      ? []
      : [
          title,
          ...items.map(linkLine),
          ...(truncated ? ["and more (first 100 shown)"] : []),
        ];
  const links_ = section("Links", links.links, links.linksTruncated);
  const backlinks = section(
    "Linked from",
    links.backlinks,
    links.backlinksTruncated
  );
  return [
    ...links_,
    ...(links_.length && backlinks.length ? [""] : []),
    ...backlinks,
  ].join("\n");
};
