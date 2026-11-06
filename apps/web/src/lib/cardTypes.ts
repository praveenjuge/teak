import type { CardType } from "@teak/convex/shared/constants";
import {
  type FileFormat,
  inferFileFormat,
} from "@teak/convex/shared/fileFormats";
import { type LinkTitleTranslator, resolveLinkTitle } from "./linkTitle";
import { markdownToPlainText } from "./markdownToPlainText";

/**
 * What each card type is, in one place: whether it holds a stored file, and
 * how much room its tile and its dialog give the card itself.
 */
interface CardTypeSpec {
  /** The dialog's stage: a large media frame, a reading column, or small. */
  dialogStage: "media" | "text" | "compact";
  /** The card is a file someone saved: it has a name and can download. */
  file: boolean;
  /** Its tile always shows a picture (a link or palette does when it has one). */
  pictureTile: boolean;
}

const CARD_TYPE_SPECS = {
  text: { dialogStage: "text", file: false, pictureTile: false },
  link: { dialogStage: "media", file: false, pictureTile: false },
  image: { dialogStage: "media", file: true, pictureTile: true },
  video: { dialogStage: "media", file: true, pictureTile: true },
  audio: { dialogStage: "compact", file: true, pictureTile: false },
  document: { dialogStage: "media", file: true, pictureTile: true },
  palette: { dialogStage: "compact", file: false, pictureTile: false },
  quote: { dialogStage: "compact", file: false, pictureTile: false },
} as const satisfies Record<CardType, CardTypeSpec>;

const specOf = (type: string | undefined): CardTypeSpec | undefined =>
  type && type in CARD_TYPE_SPECS
    ? CARD_TYPE_SPECS[type as CardType]
    : undefined;

export const isFileCardType = (type: string | undefined): boolean =>
  specOf(type)?.file === true;

export const cardDialogStage = (
  type: string | undefined
): CardTypeSpec["dialogStage"] => specOf(type)?.dialogStage ?? "compact";

export const showsPictureTile = (type: string | undefined): boolean =>
  specOf(type)?.pictureTile === true;

interface FileCard {
  fileMetadata?: { fileName?: string; mimeType?: string };
}

/**
 * A file card's format, from its name and its type: either alone is enough
 * (a GIF is `image/gif` or a `.gif` name).
 */
export const cardFileFormat = (card: FileCard): FileFormat | null => {
  const { fileName, mimeType } = card.fileMetadata ?? {};
  if (!(fileName || mimeType)) {
    return null;
  }
  return inferFileFormat({ fileName: fileName || "file", mimeType });
};

export const isGifCard = (card: FileCard): boolean =>
  cardFileFormat(card)?.id === "gif";

interface TitledCard extends FileCard {
  content?: string;
  metadata?: { linkPreview?: { status?: string; title?: string } };
  metadataTitle?: string;
  metadataTitleEdited?: boolean;
  type?: string;
  url?: string;
}

/** A link's title: the person's own, the page's, the stored one, the URL. */
export const linkCardTitle = (
  card: TitledCard,
  t?: LinkTitleTranslator
): string =>
  resolveLinkTitle(
    {
      metadataTitle: card.metadataTitle,
      metadataTitleEdited: card.metadataTitleEdited,
      previewTitle:
        card.metadata?.linkPreview?.status === "success"
          ? card.metadata.linkPreview.title
          : undefined,
      url: card.url,
    },
    t
  );

/**
 * The title every surface names a card by, or "" for a card with none: a
 * link's title, a file's title or name, any other card's title or the first
 * line of its text.
 */
export const cardTitle = (
  card: TitledCard,
  t?: LinkTitleTranslator
): string => {
  if (card.type === "link") {
    return linkCardTitle(card, t);
  }
  if (isFileCardType(card.type)) {
    return card.metadataTitle || card.fileMetadata?.fileName || "";
  }
  return (
    card.metadataTitle ||
    markdownToPlainText(card.content?.trim().split("\n", 1)[0]).trim()
  );
};
