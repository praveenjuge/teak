/**
 * The title a link card shows. A title the person set (an edit, or the
 * bookmark name from an import) wins over the page's fetched title; otherwise
 * the fetched title, then any stored title, then the URL.
 */
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
