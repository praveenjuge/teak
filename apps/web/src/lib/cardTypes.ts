import type { api } from "@teak/convex";
import type { CardType } from "@teak/convex/shared/constants";
import {
  type FileFormat,
  inferFileFormat,
} from "@teak/convex/shared/fileFormats";
import type { FunctionReturnType } from "convex/server";
import {
  File,
  FileText,
  Image,
  Link,
  Palette,
  Quote,
  type VadivamIcon,
  Video,
  Volume2,
} from "vadivam-react";
import { type LinkTitleTranslator, resolveLinkTitle } from "./linkTitle";
import { markdownToPlainText } from "./markdownToPlainText";

/**
 * A card as the server sends it to the app: the stored card with its files'
 * signed addresses.
 */
export type ClientCard = FunctionReturnType<typeof api.cards.getCards>[number];

/** The room around the card in the dialog's stage, before it is shown. */
type StagePadding =
  | string
  | ((card: FileCard & { fileUrl?: string }) => string);

/**
 * What each card type is, in one place: its icon, whether it holds a stored
 * file or text people edit, and how much room its tile and its dialog give
 * the card itself.
 */
interface CardTypeSpec {
  /** The dialog's stage: a large media frame, a reading column, or small. */
  dialogStage: "media" | "text" | "compact";
  /** Its text is the card, edited in the dialog: a note or a quote. */
  editableText: boolean;
  /** The card is a file someone saved: it has a name and can download. */
  file: boolean;
  /** The icon every list, menu and filter shows for the type. */
  icon: VadivamIcon;
  /** Its tile always shows a picture (a link or palette does when it has one). */
  pictureTile: boolean;
  /** How the dialog's stage lays the card out. */
  stage: StagePadding;
}

const CENTERED_STAGE =
  "flex min-h-full items-center justify-center p-5 md:p-10";

const CARD_TYPE_SPECS = {
  text: {
    dialogStage: "text",
    editableText: true,
    file: false,
    icon: FileText,
    pictureTile: false,
    stage: "mx-auto w-full max-w-3xl px-5 pt-5 pb-6 md:px-10 md:pt-10 md:pb-12",
  },
  link: {
    dialogStage: "media",
    editableText: false,
    file: false,
    icon: Link,
    pictureTile: false,
    stage: "px-5 pt-5 pb-6 md:px-10 md:pt-8 md:pb-10",
  },
  image: {
    dialogStage: "media",
    editableText: false,
    file: true,
    icon: Image,
    pictureTile: true,
    stage: "flex min-h-full items-center justify-center p-4 md:h-full md:p-8",
  },
  video: {
    dialogStage: "media",
    editableText: false,
    file: true,
    icon: Video,
    pictureTile: true,
    stage:
      "flex items-center justify-center bg-black max-md:aspect-video md:h-full",
  },
  audio: {
    dialogStage: "compact",
    editableText: false,
    file: true,
    icon: Volume2,
    pictureTile: false,
    stage: CENTERED_STAGE,
  },
  document: {
    dialogStage: "media",
    editableText: false,
    file: true,
    icon: File,
    pictureTile: true,
    // A PDF fills the stage; other documents read in a padded column.
    stage: (card) =>
      cardFileFormat(card)?.preview === "pdf" && card.fileUrl
        ? "h-[70dvh] p-2 md:h-full md:p-3"
        : "p-5 md:p-8",
  },
  palette: {
    dialogStage: "compact",
    editableText: false,
    file: false,
    icon: Palette,
    pictureTile: false,
    stage: CENTERED_STAGE,
  },
  quote: {
    dialogStage: "compact",
    editableText: true,
    file: false,
    icon: Quote,
    pictureTile: false,
    stage: CENTERED_STAGE,
  },
} as const satisfies Record<CardType, CardTypeSpec>;

const specOf = (type: string | undefined): CardTypeSpec | undefined =>
  type && type in CARD_TYPE_SPECS
    ? CARD_TYPE_SPECS[type as CardType]
    : undefined;

export const isFileCardType = (type: string | undefined): boolean =>
  specOf(type)?.file === true;

/** A note or a quote: its text is the card, edited in place. */
export const hasEditableText = (type: string | undefined): boolean =>
  specOf(type)?.editableText === true;

export const cardDialogStage = (
  type: string | undefined
): CardTypeSpec["dialogStage"] => specOf(type)?.dialogStage ?? "compact";

/** How the dialog's stage lays out this card. */
export const cardStageClass = (
  card: FileCard & { fileUrl?: string; type?: string }
): string => {
  const stage = specOf(card.type)?.stage ?? CENTERED_STAGE;
  return typeof stage === "function" ? stage(card) : stage;
};

export const showsPictureTile = (type: string | undefined): boolean =>
  specOf(type)?.pictureTile === true;

/** The icon for a card type; a note's for one it doesn't know. */
export const cardTypeIcon = (type: string | undefined): VadivamIcon =>
  specOf(type)?.icon ?? FileText;

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

/** The open card's field as it is being edited, ahead of the save. */
export type GetCurrentValue = (
  field: "content" | "url" | "notes" | "aiSummary" | "metadataTitle"
) => string | undefined;
