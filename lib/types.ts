export type CardType =
  | "text"
  | "link"
  | "image"
  | "video"
  | "audio"
  | "document";

export interface CardData {
  _id: string;
  userId: string;
  title?: string;
  content: string;
  type: CardType;
  url?: string;
  fileId?: string;
  thumbnailId?: string;
  tags?: string[];
  description?: string;
  isFavorited?: boolean;
  metadata?: {
    linkTitle?: string;
    linkDescription?: string;
    linkImage?: string;
    linkFavicon?: string;
    fileSize?: number;
    fileName?: string;
    mimeType?: string;
    duration?: number;
  };
  createdAt: number;
  updatedAt: number;
}

export const CARD_TYPES: CardType[] = [
  "text",
  "link",
  "image",
  "video",
  "audio",
  "document",
];

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  text: "text",
  link: "links",
  image: "images",
  video: "videos",
  audio: "audios",
  document: "documents",
};

export interface TypeaheadOption {
  value: CardType | "favorites";
  label: string;
}

export const RESERVED_KEYWORDS: TypeaheadOption[] = [
  { value: "text", label: "text" },
  { value: "link", label: "links" },
  { value: "image", label: "images" },
  { value: "video", label: "videos" },
  { value: "audio", label: "audios" },
  { value: "document", label: "documents" },
  { value: "favorites", label: "favorites" },
];
