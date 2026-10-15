"use client";

import {
  MARKDOWN_CONTENT_MAX_BYTES,
  markdownContentByteLength,
} from "@teak/convex/shared/markdown";
import { cn } from "@teak/ui/lib/utils";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useState,
} from "react";
import { escapeTypedHtml } from "./typedHtml";
import type { MarkdownTextEditorProps } from "./types";

/** Whether the stand-in has focus, so the rich editor takes the caret over. */
export interface StandInFocus {
  current: boolean;
}

/** The editor's frame, shared by the rich editor and its stand-in. */
export function EditorFieldset({
  ariaLabel = "Markdown note",
  children,
  className,
  minHeight,
  variant = "document",
}: Pick<
  MarkdownTextEditorProps,
  "ariaLabel" | "className" | "minHeight" | "variant"
> & { children: ReactNode }) {
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
          ? ({ "--teak-editor-min-height": minHeight } as CSSProperties)
          : undefined
      }
    >
      {children}
    </fieldset>
  );
}

/**
 * A plain textarea that edits the same Markdown string while the rich
 * editor's code loads, with its save and full-screen shortcuts and limit.
 */
export function MarkdownStandIn({
  ariaLabel = "Markdown note",
  autoFocus,
  disabled,
  focus,
  onChange,
  onLimitExceeded,
  onOpenFullScreen,
  onSaveShortcut,
  placeholder = "Write a note…",
  ref,
  value,
}: MarkdownTextEditorProps & {
  focus: StandInFocus;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const [escapesHtml] = useState(() => escapeTypedHtml(value) === value);
  const [typed, setTyped] = useState({ markdown: value, text: value });
  const text = typed.markdown === value ? typed.text : value;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey) || disabled) {
      return;
    }
    const key = event.key.toLowerCase();
    let shortcut: (() => void) | undefined;
    if (key === "enter") {
      shortcut = onSaveShortcut;
    } else if (key === "e") {
      shortcut = onOpenFullScreen;
    }
    if (shortcut) {
      event.preventDefault();
      shortcut();
    }
  };
  return (
    <textarea
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      className="block h-full min-h-[var(--teak-editor-min-height,8rem)] w-full resize-none bg-transparent p-1 font-sans text-[length:var(--teak-editor-font-size,1rem)] leading-[1.65] outline-none placeholder:text-muted-foreground disabled:cursor-default"
      data-editor-fallback=""
      disabled={disabled}
      onBlur={() => {
        focus.current = false;
      }}
      onChange={(event) => {
        const next = event.target.value;
        const markdown = escapesHtml ? escapeTypedHtml(next) : next;
        if (markdownContentByteLength(markdown) > MARKDOWN_CONTENT_MAX_BYTES) {
          onLimitExceeded?.();
          return;
        }
        setTyped({ markdown, text: next });
        onChange(markdown);
      }}
      onFocus={() => {
        focus.current = true;
      }}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      ref={ref}
      spellCheck
      value={text}
    />
  );
}
