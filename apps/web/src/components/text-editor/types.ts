import type { CardType } from "@teak/convex/shared/constants";

export interface CardLinkSuggestion {
  id: string;
  title: string;
  type: CardType;
}

/** A linked card as the pill shows it; `missing` when trashed or not yours. */
export interface CardLinkTarget {
  id: string;
  missing: boolean;
  title: string | null;
  type: CardType | null;
}

/** Turns on `[[` card links in the editor. */
export interface CardLinkOptions {
  onOpenCard?: (cardId: string) => void;
  /** Cards to offer for a typed query; an empty query offers recent ones. */
  search: (query: string) => Promise<CardLinkSuggestion[]>;
  /** Live titles of the linked cards, by id; undefined while loading. */
  targets?: ReadonlyMap<string, CardLinkTarget>;
}

export interface MarkdownTextEditorProps {
  ariaLabel?: string;
  autoFocus?: boolean;
  cardLinks?: CardLinkOptions;
  className?: string;
  disabled?: boolean;
  minHeight?: string;
  onChange: (content: string) => void;
  onLimitExceeded?: () => void;
  onOpenFullScreen?: () => void;
  /** Takes files pasted with no text, such as a copied screenshot. */
  onPasteFiles?: (files: File[]) => void;
  onSaveShortcut?: () => void;
  placeholder?: string;
  value: string;
  variant?: "compact" | "document" | "modal";
}
