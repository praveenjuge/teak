import { useState } from "react";

export function useFocusMode(content: string) {
  const [contentAtOpen, setContentAtOpen] = useState<string | null>(null);
  return {
    close: () => setContentAtOpen(null),
    inlineEditorValue: contentAtOpen ?? content,
    isFocusOpen: contentAtOpen !== null,
    open: () => setContentAtOpen(content),
  };
}
