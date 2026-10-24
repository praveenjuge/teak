"use client";

import {
  MARKDOWN_CONTENT_MAX_BYTES,
  markdownContentByteLength,
} from "@teak/convex/shared/markdown";
import { useTranslations } from "@teak/i18n/react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useState,
} from "react";
import { extractFilesFromDataTransfer } from "@/lib/upload/fileDrop";
import { cn } from "@/lib/utils";
import { escapeTypedHtml } from "./typedHtml";
import type { MarkdownTextEditorProps } from "./types";

export interface StandInFocus {
  current: boolean;
}

export function EditorFieldset({
  ariaLabel,
  children,
  className,
  minHeight,
  variant = "document",
}: Pick<
  MarkdownTextEditorProps,
  "ariaLabel" | "className" | "minHeight" | "variant"
> & { children: ReactNode }) {
  const t = useTranslations("textEditor.note");
  return (
    <fieldset
      aria-label={t("editorLabel", { label: ariaLabel ?? t("ariaLabel") })}
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

export function MarkdownStandIn({
  ariaLabel,
  autoFocus,
  disabled,
  focus,
  onChange,
  onLimitExceeded,
  onOpenFullScreen,
  onPasteFiles,
  onSaveShortcut,
  placeholder,
  ref,
  value,
}: MarkdownTextEditorProps & {
  focus: StandInFocus;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const t = useTranslations("textEditor.note");
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
      aria-label={ariaLabel ?? t("ariaLabel")}
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
      onPaste={(event) => {
        if (!onPasteFiles || event.clipboardData.getData("text/plain")) {
          return;
        }
        const { files } = extractFilesFromDataTransfer(event.clipboardData);
        if (files.length > 0) {
          event.preventDefault();
          onPasteFiles(files);
        }
      }}
      placeholder={placeholder ?? t("placeholder")}
      ref={ref}
      spellCheck
      value={text}
    />
  );
}
