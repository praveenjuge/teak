import type { Card } from "@teak/sdk";

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

export const formatDetail = (card: Card) =>
  [
    `id: ${card.id}`,
    `type: ${card.type}`,
    `created: ${new Date(card.createdAt).toISOString()}`,
    `updated: ${new Date(card.updatedAt).toISOString()}`,
    card.url ? `url: ${card.url}` : null,
    card.notes ? `notes: ${card.notes}` : null,
    card.tags.length ? `tags: ${card.tags.join(", ")}` : null,
    "",
    card.content,
  ]
    .filter((line) => line !== null)
    .join("\n");
