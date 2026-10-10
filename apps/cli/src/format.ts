import type { Card } from "@teak/convex/sdk";

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

export const formatCardLine = (
  card:
    | Card
    | {
        content?: string;
        createdAt: number;
        id: string;
        tags?: string[];
        type: string;
      }
) => {
  const text = (card.content || "").replace(/\s+/g, " ").trim();
  const snippet =
    text.length > 54
      ? `${text.slice(0, 53)}...`
      : text.padEnd(Math.min(54, Math.max(10, text.length)));
  const tags = (card.tags || [])
    .slice(0, 4)
    .map((tag) => `#${tag}`)
    .join(" ");
  const age = relativeAge(Date.now() - card.createdAt);
  return `${card.id}  ${card.type.padEnd(8)}  ${snippet}  ${tags}  ${age}`.trim();
};

const TRANSCRIPT_PREVIEW_CHARS = 600;

const fileLine = (card: Card) => {
  if (!card.fileName) {
    return null;
  }
  const size = card.fileSize ? ` (${formatBytes(card.fileSize)})` : "";
  return `file: ${card.fileName}${size}`;
};

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
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

export const formatDetail = (card: Card) =>
  [
    `id: ${card.id}`,
    `type: ${card.type}`,
    card.metadataTitle ? `title: ${card.metadataTitle}` : null,
    `created: ${new Date(card.createdAt).toISOString()}`,
    `updated: ${new Date(card.updatedAt).toISOString()}`,
    card.isFavorited ? "favorite: yes" : null,
    card.isDeleted ? "in trash: yes" : null,
    card.url ? `url: ${card.url}` : null,
    fileLine(card),
    card.notes ? `notes: ${card.notes}` : null,
    card.tags.length ? `tags: ${card.tags.join(", ")}` : null,
    card.aiTags?.length ? `ai tags: ${card.aiTags.join(", ")}` : null,
    card.colors?.length
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
