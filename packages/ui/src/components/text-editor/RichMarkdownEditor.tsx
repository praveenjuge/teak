import {
  BlockEditor,
  defaultSlashCommandItems,
  SlashCommand,
  type SlashCommandSuggestionItem,
} from "@editorcn/block-editor";
import { isSafeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { Extension } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EditorFormatting } from "./EditorControls";
import {
  documentExtensions,
  hasSameMarkdownMeaning,
  isWithinMarkdownLimit,
  markdownManager,
  prepareMarkdownDocument,
} from "./markdownDocument";
import { SlashMenu } from "./SlashMenu";
import type { MarkdownTextEditorProps } from "./types";

const commands = defaultSlashCommandItems;
const slashKey = new PluginKey("teakSlashCommands");

export function RichMarkdownEditor(props: MarkdownTextEditorProps) {
  const callbacks = useRef(props);
  callbacks.current = props;
  const lastValue = useRef(props.value);
  const [initial] = useState(() => prepareMarkdownDocument(props.value));
  const [menu, setMenu] =
    useState<SuggestionProps<SlashCommandSuggestionItem> | null>(null);
  const selectedCommand = useRef(0);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const [extensions] = useState(() => [
    ...documentExtensions(),
    Markdown,
    Placeholder.configure({
      placeholder: props.placeholder ?? "Write a note…",
    }),
    SlashCommand.configure({
      suggestion: {
        pluginKey: slashKey,
        render: () => ({
          onStart: (next) => {
            selectedCommand.current = 0;
            setMenu(next);
          },
          onUpdate: (next) => {
            selectedCommand.current = 0;
            setMenu(next);
          },
          onExit: () => setMenu(null),
          onKeyDown: ({ event, view }) => {
            const current = menuRef.current;
            if (event.key === "Escape") {
              exitSuggestion(view, slashKey);
              return true;
            }
            if (!current?.items.length) {
              return false;
            }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              selectedCommand.current =
                (selectedCommand.current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  current.items.length) %
                current.items.length;
              setMenu({ ...current });
              return true;
            }
            if (event.key === "Enter") {
              current.command(current.items[selectedCommand.current]);
              return true;
            }
            return false;
          },
        }),
        items: ({ query }) =>
          commands.filter((item) =>
            `${item.title} ${item.keywords.join(" ")}`
              .toLowerCase()
              .includes(query.toLowerCase())
          ),
        allow: ({ editor: current }) =>
          !(
            current.isActive("codeBlock") || current.isActive("literalMarkdown")
          ),
      },
    }),
    Extension.create({
      name: "teakMarkdownSafety",
      addKeyboardShortcuts() {
        return {
          "Mod-Enter": () => {
            if (callbacks.current.disabled) {
              return false;
            }
            callbacks.current.onSaveShortcut?.();
            return Boolean(callbacks.current.onSaveShortcut);
          },
          "Mod-e": () => {
            if (callbacks.current.disabled) {
              return false;
            }
            callbacks.current.onOpenFullScreen?.();
            return Boolean(callbacks.current.onOpenFullScreen);
          },
        };
      },
      addProseMirrorPlugins() {
        return [
          new Plugin({
            filterTransaction(transaction) {
              if (!transaction.docChanged) {
                return true;
              }
              if (callbacks.current.disabled) {
                return false;
              }
              const markdown = markdownManager.serialize(
                transaction.doc.toJSON()
              );
              if (!isWithinMarkdownLimit(markdown)) {
                queueMicrotask(() => callbacks.current.onLimitExceeded?.());
                return false;
              }
              let safe = true;
              transaction.doc.descendants((node) => {
                if (
                  node.marks.some(
                    (mark) =>
                      mark.type.name === "link" &&
                      !isSafeExternalUrl(mark.attrs.href)
                  )
                ) {
                  safe = false;
                }
              });
              if (!safe) {
                queueMicrotask(() =>
                  toast.error("This change cannot be saved as Markdown.")
                );
              }
              return safe;
            },
          }),
        ];
      },
    }),
  ]);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    content: initial.document,
    editable: !props.disabled,
    autofocus: props.autoFocus ? "end" : false,
    extensions,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": props.ariaLabel ?? "Markdown note",
        "aria-multiline": "true",
        "aria-placeholder": props.placeholder ?? "Write a note…",
        spellcheck: "true",
        "aria-readonly": String(Boolean(props.disabled)),
      },
      handleDrop(_view, event) {
        event.preventDefault();
        toast.info("Paste text or Markdown into this note.");
        return true;
      },
      handlePaste(view, event) {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const current = view.state.selection;
        if (callbacks.current.disabled) {
          return true;
        }
        event.preventDefault();
        if (!text) {
          toast.info("Paste plain text or Markdown.");
          return true;
        }
        if (
          !(current.empty || editor?.isActive("literalMarkdown")) &&
          isSafeExternalUrl(text.trim())
        ) {
          editor?.chain().focus().setLink({ href: text.trim() }).run();
          return true;
        }
        const prepared = prepareMarkdownDocument(text);
        if (editor?.isActive("literalMarkdown") && current.from === 0) {
          editor.commands.insertContent({
            type: "literalMarkdown",
            content: [{ type: "text", text }],
          });
        } else if (editor?.isActive("literalMarkdown") || prepared.literal) {
          // A text node keeps HTML/images inert and preserves the pasted text.
          editor?.commands.insertContent({ type: "text", text });
        } else {
          editor?.commands.insertContent(prepared.document.content ?? []);
        }
        return true;
      },
    },
    onUpdate({ editor: current }) {
      const markdown = current.getMarkdown();
      if (
        markdown !== lastValue.current &&
        !hasSameMarkdownMeaning(markdown, lastValue.current)
      ) {
        lastValue.current = markdown;
        callbacks.current.onChange(markdown);
      }
    },
  });

  useEffect(() => {
    if (!editor || props.value === lastValue.current) {
      return;
    }
    const prepared = prepareMarkdownDocument(props.value);
    lastValue.current = props.value;
    editor.commands.setContent(prepared.document, { emitUpdate: false });
  }, [editor, props.value]);

  useEffect(() => {
    editor?.setEditable(!props.disabled);
  }, [editor, props.disabled]);

  if (!editor) {
    return null;
  }
  return (
    <BlockEditor editor={editor}>
      {!props.disabled && <EditorFormatting editor={editor} />}
      <EditorContent className="block-editor-content" editor={editor} />
      {menu && <SlashMenu menu={menu} selected={selectedCommand.current} />}
    </BlockEditor>
  );
}
