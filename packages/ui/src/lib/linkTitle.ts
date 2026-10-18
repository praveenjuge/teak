export function resolveLinkTitle(card: {
  metadataTitle?: string;
  metadataTitleEdited?: boolean;
  previewTitle?: string;
  url?: string;
}): string {
  return (
    (card.metadataTitleEdited ? card.metadataTitle : undefined) ||
    card.previewTitle ||
    card.metadataTitle ||
    card.url ||
    "Link"
  );
}
