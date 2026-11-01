import type { CardType } from "@teak/convex/shared/constants";

export interface CardLinkSuggestion {
  id: string;
  title: string;
  type: CardType;
}

export interface CardLinkTarget {
  id: string;
  missing: boolean;
  title: string | null;
  type: CardType | null;
}

export interface CardLinkOptions {
  onOpenCard?: (cardId: string) => void;
  search: (query: string) => Promise<CardLinkSuggestion[]>;
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
  onPasteFiles?: (files: File[]) => void;
  onSaveShortcut?: () => void;
  placeholder?: string;
  value: string;
  variant?: "compact" | "document" | "modal";
}
