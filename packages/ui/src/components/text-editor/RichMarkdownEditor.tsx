import {
  BlockEditor,
  defaultSlashCommandItems,
  SlashCommand,
  type SlashCommandSuggestionItem,
} from "@editorcn/block-editor";
import { isSafeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { type Editor, Extension } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import {
  AddMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
} from "@tiptap/pm/transform";
import { EditorContent, useEditor } from "@tiptap/react";
import { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EditorFormatting } from "./EditorControls";
import {
  documentExtensions,
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
  const [initial] = useState(() => {
    const prepared = prepareMarkdownDocument(props.value);
    return {
      ...prepared,
      serialized: markdownManager.serialize(prepared.document),
      value: props.value,
    };
  });
  const lastSerialized = useRef(initial.serialized);
  const syncedEditor = useRef<Editor | null>(null);
  const [menu, setMenu] =
    useState<SuggestionProps<SlashCommandSuggestionItem> | null>(null);
  const selectedCommand = useRef(0);
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const [extensions] = useState(() => [
    ...documentExtensions(),
    Markdown,
    Placeholder.configure({
      showOnlyWhenEditable: false,
      placeholder: () => callbacks.current.placeholder ?? "Write a note…",
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
              if (
                !transaction.docChanged ||
                transaction.getMeta("teakExternalSync")
              ) {
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
              for (const step of transaction.steps) {
                if (
                  step instanceof AddMarkStep &&
                  step.mark.type.name === "link" &&
                  !isSafeExternalUrl(step.mark.attrs.href)
                ) {
                  safe = false;
                }
                if (
                  step instanceof ReplaceStep ||
                  step instanceof ReplaceAroundStep
                ) {
                  step.slice.content.descendants((node) => {
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
                }
              }
              if (!safe) {
                queueMicrotask(() =>
                  toast.error("This change cannot be saved as Markdown.")
                );
              }
              if (safe) {
                transaction.setMeta("teakMarkdown", markdown);
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
      attributes: () => ({
        role: "textbox",
        "aria-label": callbacks.current.ariaLabel ?? "Markdown note",
        "aria-multiline": "true",
        "aria-placeholder": callbacks.current.placeholder ?? "Write a note…",
        spellcheck: "true",
        "aria-readonly": String(Boolean(callbacks.current.disabled)),
      }),
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
    onUpdate({ editor: current, transaction }) {
      const markdown: string =
        transaction.getMeta("teakMarkdown") ?? current.getMarkdown();
      if (markdown === lastSerialized.current) {
        return;
      }
      lastSerialized.current = markdown;
      if (markdown !== lastValue.current) {
        lastValue.current = markdown;
        callbacks.current.onChange(markdown);
      }
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    if (syncedEditor.current !== editor) {
      // Every editor instance starts from `initial`. React destroys and
      // recreates the editor while keeping this component's state when a
      // hidden <Activity> is shown again, as Next.js does for a route it
      // keeps for back navigation, so sync the current value into it.
      syncedEditor.current = editor;
      lastValue.current = initial.value;
      lastSerialized.current = initial.serialized;
    }
    if (props.value === lastValue.current) {
      return;
    }
    const prepared = prepareMarkdownDocument(props.value);
    editor
      .chain()
      .setMeta("teakExternalSync", true)
      .setContent(prepared.document, { emitUpdate: false })
      .run();
    lastValue.current = props.value;
    lastSerialized.current = markdownManager.serialize(prepared.document);
  }, [editor, initial, props.value]);

  useEffect(() => {
    if (editor) {
      editor.setEditable(!props.disabled);
      editor.view.dispatch(
        editor.state.tr.setMeta("teakPlaceholder", props.placeholder)
      );
    }
  }, [editor, props.disabled, props.placeholder]);

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
