import {
  BlockEditor,
  defaultSlashCommandItems,
  SlashCommand,
  type SlashCommandSuggestionItem,
} from "@editorcn/block-editor";
import { cardLinkTokenTitle } from "@teak/convex/shared/cardLinks";
import { isSafeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { type Editor, Extension } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "@tiptap/markdown";
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
} from "@tiptap/pm/state";
import {
  AddMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
} from "@tiptap/pm/transform";
import { EditorContent, useEditor } from "@tiptap/react";
import Suggestion, {
  exitSuggestion,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { Table as TableIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { extractFilesFromDataTransfer } from "@/lib/upload/fileDrop";
import { CardLinkMenu, type CardLinkMenuState } from "./CardLinkMenu";
import { CardLinkPillNode, CardLinkViewContext } from "./CardLinkPill";
import { EditorFormatting } from "./EditorControls";
import {
  documentExtensions,
  isWithinMarkdownLimit,
  markdownManager,
  prepareMarkdownDocument,
} from "./markdownDocument";
import { SlashMenu } from "./SlashMenu";
import { TableMenu } from "./TableMenu";
import { insertNewTable, pasteIntoTable, TableKeys } from "./tableEditing";
import { TaskListSort } from "./taskListSort";
import type { CardLinkSuggestion, MarkdownTextEditorProps } from "./types";

const commands: SlashCommandSuggestionItem[] = [
  ...defaultSlashCommandItems,
  {
    id: "table",
    title: "Table",
    description: "A table with a header row",
    keywords: ["grid", "columns", "rows"],
    icon: <TableIcon />,
    command: ({ editor, range }) => {
      insertNewTable(editor, range);
    },
  },
];
const slashKey = new PluginKey("teakSlashCommands");
const cardLinkKey = new PluginKey("teakCardLinks");
/** An open slash or `[[` menu keeps Enter and Tab inside a table cell. */
const isSuggesting = (state: EditorState) =>
  Boolean(
    slashKey.getState(state)?.active || cardLinkKey.getState(state)?.active
  );
const CARD_LINK_SEARCH_DEBOUNCE_MS = 150;

const inCode = (editor: Editor) =>
  editor.isActive("codeBlock") ||
  editor.isActive("literalMarkdown") ||
  editor.isActive("code");

/** Enter on a selected pill opens its card. */
const openSelectedCardLink = (
  editor: Editor,
  open?: (cardId: string) => void
): boolean => {
  const { selection } = editor.state;
  if (
    !(open && selection instanceof NodeSelection) ||
    selection.node.type.name !== "cardLink"
  ) {
    return false;
  }
  open(String(selection.node.attrs.cardId));
  return true;
};

export function RichMarkdownEditor({
  onEditorReady,
  ...props
}: MarkdownTextEditorProps & {
  onEditorReady?: (editor: Editor) => void;
}) {
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
  const [linkMenu, setLinkMenu] =
    useState<SuggestionProps<CardLinkSuggestion> | null>(null);
  const linkMenuRef = useRef(linkMenu);
  linkMenuRef.current = linkMenu;
  const [linkState, setLinkState] = useState<CardLinkMenuState>({
    status: "loading",
  });
  const linkStateRef = useRef(linkState);
  linkStateRef.current = linkState;
  const [selectedLink, setSelectedLink] = useState(0);
  const selectedLinkRef = useRef(selectedLink);
  selectedLinkRef.current = selectedLink;
  const linkQuery = linkMenu?.query;
  const [extensions] = useState(() => [
    ...documentExtensions({ cardLinkNode: CardLinkPillNode }),
    TaskListSort,
    TableKeys(isSuggesting),
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
        // A cell holds one line of text, so block commands (and a table in a
        // table) don't apply there.
        allow: ({ editor: current }) =>
          !(
            current.isActive("codeBlock") ||
            current.isActive("literalMarkdown") ||
            current.isActive("table")
          ),
      },
    }),
    Extension.create({
      name: "teakCardLinks",
      addKeyboardShortcuts() {
        const openSelectedPill = () =>
          openSelectedCardLink(
            this.editor,
            callbacks.current.cardLinks?.onOpenCard
          );
        return { Enter: openSelectedPill };
      },
      addProseMirrorPlugins() {
        return [
          Suggestion<CardLinkSuggestion>({
            editor: this.editor,
            pluginKey: cardLinkKey,
            char: "[[",
            allowSpaces: true,
            allowedPrefixes: null,
            items: () => [],
            // A link's `|` would need escaping in a table cell, which the
            // card-link parsers outside the editor don't read.
            allow: ({ editor: current }) =>
              Boolean(callbacks.current.cardLinks) &&
              !callbacks.current.disabled &&
              !inCode(current) &&
              !current.isActive("table"),
            command: ({ editor: current, range, props: item }) => {
              current
                .chain()
                .focus()
                .insertContentAt(range, [
                  {
                    type: "cardLink",
                    attrs: {
                      cardId: item.id,
                      title: cardLinkTokenTitle(item.title),
                    },
                  },
                  { type: "text", text: " " },
                ])
                .run();
            },
            render: () => ({
              onStart: (next) => {
                setSelectedLink(0);
                setLinkMenu(next);
              },
              onUpdate: (next) => {
                setSelectedLink(0);
                setLinkMenu(next);
              },
              onExit: () => setLinkMenu(null),
              onKeyDown: ({ event, view }) => {
                const current = linkMenuRef.current;
                if (event.key === "Escape") {
                  exitSuggestion(view, cardLinkKey);
                  return true;
                }
                const state = linkStateRef.current;
                const items = state.status === "ready" ? state.items : [];
                if (!(current && items.length)) {
                  // Enter waits for a search in flight; with no match or an
                  // error it types a new line as usual.
                  return (
                    event.key === "Enter" &&
                    Boolean(current) &&
                    state.status === "loading"
                  );
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  setSelectedLink(
                    (selectedLinkRef.current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                      items.length
                  );
                  return true;
                }
                if (event.key === "Enter") {
                  const item = items[selectedLinkRef.current];
                  if (item) {
                    current.command(item);
                  }
                  return true;
                }
                return false;
              },
            }),
          }),
        ];
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
          const { files } = extractFilesFromDataTransfer(event.clipboardData);
          const { onPasteFiles } = callbacks.current;
          if (onPasteFiles && files.length > 0) {
            onPasteFiles(files);
            return true;
          }
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
        if (
          editor &&
          pasteIntoTable(
            editor,
            text,
            prepared.literal ? null : (prepared.document.content ?? [])
          )
        ) {
          return true;
        }
        if (editor?.isActive("literalMarkdown") && current.from === 0) {
          editor.commands.insertContent({
            type: "literalMarkdown",
            content: [{ type: "text", text }],
          });
        } else if (editor?.isActive("literalMarkdown") || prepared.literal) {
          editor?.commands.insertContent({ type: "text", text });
        } else {
          editor?.commands.insertContent(prepared.document.content ?? []);
        }
        return true;
      },
    },
    onUpdate({ editor: current, transaction, appendedTransactions }) {
      // A plugin's appended change (a ticked item moving down) comes last,
      // and carries the Markdown of the final document.
      const markdown: string =
        (
          appendedTransactions[appendedTransactions.length - 1] ?? transaction
        ).getMeta("teakMarkdown") ?? current.getMarkdown();
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

  // Effects can run with an editor useEditor has already destroyed: it
  // destroys the instance when a hidden <Activity> disconnects its effects
  // and makes a new one when they reconnect, after this render.
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    if (syncedEditor.current !== editor) {
      // Every editor instance starts from `initial`; a new one after an
      // <Activity> reveal must catch up with the current value.
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
    if (editor && !editor.isDestroyed) {
      onEditorReady?.(editor);
    }
  }, [editor, onEditorReady]);

  // The `[[` menu's cards: searched after typing pauses; a slower answer to
  // an older query is dropped.
  useEffect(() => {
    const search = callbacks.current.cardLinks?.search;
    if (linkQuery === undefined || !search) {
      return;
    }
    let current = true;
    setLinkState({ status: "loading" });
    const timer = setTimeout(() => {
      search(linkQuery.trim()).then(
        (items) => {
          if (current) {
            setSelectedLink(0);
            setLinkState({ items, status: "ready" });
          }
        },
        () => {
          if (current) {
            setLinkState({ status: "error" });
          }
        }
      );
    }, CARD_LINK_SEARCH_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [linkQuery]);

  // A dialog around the editor sees Esc first and prevents it to stay open
  // (Focus does, while the slash menu is up), and ProseMirror ignores
  // prevented events, so the menu listens for that Esc itself.
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }
    const view = editor.view;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && event.defaultPrevented && menuRef.current) {
        exitSuggestion(view, slashKey);
      }
      if (
        event.key === "Escape" &&
        event.defaultPrevented &&
        linkMenuRef.current
      ) {
        exitSuggestion(view, cardLinkKey);
      }
    };
    view.dom.addEventListener("keydown", onKeyDown);
    return () => view.dom.removeEventListener("keydown", onKeyDown);
  }, [editor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.setEditable(!props.disabled);
      editor.view.dispatch(
        editor.state.tr.setMeta("teakPlaceholder", props.placeholder)
      );
    }
  }, [editor, props.disabled, props.placeholder]);

  const onOpenCard = props.cardLinks?.onOpenCard;
  const targets = props.cardLinks?.targets;
  const cardLinkView = useMemo(
    () => ({ onOpenCard, targets }),
    [onOpenCard, targets]
  );
  const linkAnchor = useMemo(
    () =>
      linkMenu
        ? { clientRect: linkMenu.clientRect, dom: linkMenu.editor.view.dom }
        : undefined,
    [linkMenu]
  );

  if (!editor) {
    return null;
  }
  return (
    <CardLinkViewContext.Provider value={cardLinkView}>
      <BlockEditor editor={editor}>
        {!props.disabled && <EditorFormatting editor={editor} />}
        <EditorContent className="block-editor-content" editor={editor} />
        {props.disabled ? null : <TableMenu editor={editor} />}
        {menu ? (
          <SlashMenu menu={menu} selected={selectedCommand.current} />
        ) : null}
        {linkMenu ? (
          <CardLinkMenu
            anchor={linkAnchor}
            onChoose={(item) => linkMenu.command(item)}
            query={linkMenu.query}
            selected={selectedLink}
            state={linkState}
          />
        ) : null}
      </BlockEditor>
    </CardLinkViewContext.Provider>
  );
}
