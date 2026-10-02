"use client";

import "@editorcn/block-editor/style.css";
import "./editor.css";

import { cn } from "@teak/ui/lib/utils";
import { RichMarkdownEditor } from "./RichMarkdownEditor";
import type { MarkdownTextEditorProps } from "./types";

export function MarkdownTextEditor(props: MarkdownTextEditorProps) {
  const {
    ariaLabel = "Markdown note",
    className,
    minHeight,
    variant = "document",
  } = props;
  return (
    <fieldset
      aria-label={`${ariaLabel} editor`}
      className={cn(
        "teak-markdown-editor w-full min-w-0",
        variant === "modal" && "h-full",
        className
      )}
      data-editor-variant={variant}
      style={
        minHeight
          ? ({ "--teak-editor-min-height": minHeight } as React.CSSProperties)
          : undefined
      }
    >
      <RichMarkdownEditor {...props} />
    </fieldset>
  );
}
