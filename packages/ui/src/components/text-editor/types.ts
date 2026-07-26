export interface MarkdownTextEditorProps {
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
  minHeight?: string;
  onChange: (content: string) => void;
  onLimitExceeded?: () => void;
  onOpenFullScreen?: () => void;
  onSaveShortcut?: () => void;
  placeholder?: string;
  value: string;
  variant?: "compact" | "document" | "modal";
}

export type MarkdownInlineFormat = "bold" | "code" | "italic" | "link";
