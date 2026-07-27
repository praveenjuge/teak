"use client";

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdownKeymap } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState, Text } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  placeholder as editorPlaceholder,
  keymap,
} from "@codemirror/view";
import {
  MARKDOWN_CONTENT_MAX_BYTES,
  markdownContentByteLength,
} from "@teak/convex/shared/markdown";
import { cn } from "@teak/ui/lib/utils";
import { useEffect, useRef } from "react";
import {
  applyInlineFormat,
  createLiveMarkdownPlugin,
  isSafeExternalUrl,
  selectionFormatTooltip,
} from "./liveMarkdown";
import { markdownEditorTheme } from "./markdownEditorTheme";
import {
  indentMarkdownListItem,
  outdentMarkdownListItem,
  teakMarkdownSupport,
} from "./markdownSupport";
import type { MarkdownTextEditorProps } from "./types";

const externalContentUpdate = Annotation.define<boolean>();

function markdownLineSeparator(value: string) {
  const withoutCrLf = value.replace(/\r\n/gu, "");
  return value.includes("\r\n") && !withoutCrLf.includes("\n") ? "\r\n" : "\n";
}

function pasteLinkOverSelection(event: ClipboardEvent, view: EditorView) {
  if (view.state.readOnly) {
    return false;
  }
  const selection = view.state.selection.main;
  if (selection.empty) {
    return false;
  }
  const pasted = event.clipboardData?.getData("text/plain").trim() ?? "";
  if (!isSafeExternalUrl(pasted)) {
    return false;
  }

  const label = view.state.sliceDoc(selection.from, selection.to);
  const insertion = `[${label}](${pasted})`;
  event.preventDefault();
  view.dispatch({
    changes: {
      from: selection.from,
      insert: insertion,
      to: selection.to,
    },
    selection: {
      anchor: selection.from + 1,
      head: selection.from + 1 + label.length,
    },
  });
  return true;
}

export function MarkdownTextEditor({
  ariaLabel = "Markdown note",
  autoFocus = false,
  className,
  disabled = false,
  minHeight,
  onChange,
  onLimitExceeded,
  onOpenFullScreen,
  onSaveShortcut,
  placeholder = "Write a note...",
  value,
  variant = "document",
}: MarkdownTextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lineSeparatorCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  const initialRef = useRef({
    ariaLabel,
    autoFocus,
    disabled,
    placeholder,
    value,
  });
  const callbacksRef = useRef({
    onChange,
    onLimitExceeded,
    onOpenFullScreen,
    onSaveShortcut,
  });
  callbacksRef.current = {
    onChange,
    onLimitExceeded,
    onOpenFullScreen,
    onSaveShortcut,
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const initial = initialRef.current;
    const initialLineSeparator = markdownLineSeparator(initial.value);
    const state = EditorState.create({
      doc: Text.of(initial.value.split(initialLineSeparator)),
      extensions: [
        lineSeparatorCompartmentRef.current.of(
          EditorState.lineSeparator.of(initialLineSeparator)
        ),
        teakMarkdownSupport(),
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        markdownEditorTheme,
        EditorView.editorAttributes.of({
          "data-not-typeset": "true",
        }),
        createLiveMarkdownPlugin(),
        selectionFormatTooltip,
        EditorView.domEventHandlers({
          paste: pasteLinkOverSelection,
        }),
        keymap.of([
          {
            key: "Mod-b",
            run: (view) => applyInlineFormat(view, "bold"),
          },
          {
            key: "Mod-i",
            run: (view) => applyInlineFormat(view, "italic"),
          },
          {
            key: "Mod-k",
            run: (view) => applyInlineFormat(view, "link"),
          },
          {
            key: "Mod-`",
            run: (view) => applyInlineFormat(view, "code"),
          },
          {
            key: "Mod-Shift-x",
            run: (view) => applyInlineFormat(view, "strikethrough"),
          },
          {
            key: "Tab",
            run: indentMarkdownListItem,
          },
          {
            key: "Shift-Tab",
            run: outdentMarkdownListItem,
          },
          {
            key: "Mod-Enter",
            run: () => {
              callbacksRef.current.onSaveShortcut?.();
              return Boolean(callbacksRef.current.onSaveShortcut);
            },
          },
          {
            key: "Mod-e",
            run: () => {
              callbacksRef.current.onOpenFullScreen?.();
              return Boolean(callbacksRef.current.onOpenFullScreen);
            },
          },
          ...markdownKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.contentAttributes.of({
          "aria-label": initial.ariaLabel,
          "aria-multiline": "true",
          "aria-placeholder": initial.placeholder,
          placeholder: initial.placeholder,
          role: "textbox",
          spellcheck: "true",
        }),
        editorPlaceholder(initial.placeholder),
        readOnlyCompartmentRef.current.of([
          EditorState.readOnly.of(initial.disabled),
          EditorView.editable.of(!initial.disabled),
        ]),
        EditorState.transactionFilter.of((transaction) => {
          if (
            transaction.docChanged &&
            markdownContentByteLength(transaction.state.sliceDoc(0)) >
              MARKDOWN_CONTENT_MAX_BYTES
          ) {
            callbacksRef.current.onLimitExceeded?.();
            return [];
          }
          return transaction;
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) {
            return;
          }
          const isExternal = update.transactions.every((transaction) =>
            transaction.annotation(externalContentUpdate)
          );
          if (!isExternal) {
            callbacksRef.current.onChange(update.state.sliceDoc(0));
          }
        }),
      ],
    });
    const view = new EditorView({ parent: container, state });
    viewRef.current = view;
    const releaseFocusOutsideEditor = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !container.contains(event.target) &&
        view.hasFocus
      ) {
        view.contentDOM.blur();
      }
    };
    document.addEventListener("pointerdown", releaseFocusOutsideEditor, true);

    if (initial.autoFocus) {
      requestAnimationFrame(() => {
        view.dispatch({ selection: { anchor: view.state.doc.length } });
        view.focus();
      });
    }

    return () => {
      document.removeEventListener(
        "pointerdown",
        releaseFocusOutsideEditor,
        true
      );
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.sliceDoc(0) === value) {
      return;
    }
    const lineSeparator = markdownLineSeparator(value);
    view.dispatch({
      annotations: externalContentUpdate.of(true),
      changes: {
        from: 0,
        insert: Text.of(value.split(lineSeparator)),
        to: view.state.doc.length,
      },
      effects: lineSeparatorCompartmentRef.current.reconfigure(
        EditorState.lineSeparator.of(lineSeparator)
      ),
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(disabled),
        EditorView.editable.of(!disabled),
      ]),
    });
  }, [disabled]);

  return (
    <div
      className={cn(
        "teak-markdown-editor typeset typeset-docs w-full min-w-0",
        variant === "modal" && "h-full",
        className
      )}
      data-editor-variant={variant}
      ref={containerRef}
      style={
        minHeight
          ? ({ "--teak-editor-min-height": minHeight } as React.CSSProperties)
          : undefined
      }
    />
  );
}
