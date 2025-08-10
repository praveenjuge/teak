import { Doc } from "../convex/_generated/dataModel";
import { cardTypes } from "../convex/schema";

// Use Convex-generated types
export type CardData = Doc<"cards">;
export type CardType = (typeof cardTypes)[number];
export const CARD_TYPES = [...cardTypes] as CardType[];

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
  { value: "text", label: "Text" },
  { value: "link", label: "Links" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" },
  { value: "favorites", label: "Favorites" },
];
