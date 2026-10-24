import { isSafeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { useTranslations } from "@teak/i18n/react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Italic, Link, Strikethrough } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ariaKeyShortcut } from "../../lib/keyboardShortcuts";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

const EDIT_LINK_KEYS = ["Mod", "K"] as const;

export function EditorFormatting({ editor }: { editor: Editor }) {
  const t = useTranslations("textEditor.formatting");
  const [editingLink, setEditingLink] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const bubbleOptions = useMemo(
    () => ({
      placement: "top" as const,
      offset: 8,
      onShow: () => toolbarRef.current?.querySelector("input")?.focus(),
    }),
    []
  );
  const shouldShow = useCallback(
    ({ editor: current, state }: { editor: Editor; state: Editor["state"] }) =>
      current.isEditable &&
      (!state.selection.empty || editingLink) &&
      !(current.isActive("codeBlock") || current.isActive("literalMarkdown")),
    [editingLink]
  );
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
    }),
  });
  const formats = [
    {
      id: "bold",
      name: t("bold"),
      icon: Bold,
      keys: ["Mod", "B"],
      active: active.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      id: "italic",
      name: t("italic"),
      icon: Italic,
      keys: ["Mod", "I"],
      active: active.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      id: "strikethrough",
      name: t("strikethrough"),
      icon: Strikethrough,
      keys: ["Mod", "Shift", "S"],
      active: active.strike,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      id: "inlineCode",
      name: t("inlineCode"),
      icon: Code,
      keys: undefined,
      active: active.code,
      run: () => editor.chain().focus().toggleCode().run(),
    },
  ];
  useEffect(() => {
    if (editor.isDestroyed) {
      return;
    }
    const dom = editor.view.dom;
    const openLink = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setEditingLink(true);
      }
    };
    dom.addEventListener("keydown", openLink);
    return () => dom.removeEventListener("keydown", openLink);
  }, [editor]);
  return (
    <BubbleMenu
      editor={editor}
      options={bubbleOptions}
      shouldShow={shouldShow}
      updateDelay={0}
    >
      <div
        aria-label={t("toolbar")}
        className="teak-editor-formatting flex flex-wrap items-center gap-1 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
        ref={toolbarRef}
        role="toolbar"
      >
        {formats.map((format) => (
          <ShortcutTooltip
            key={format.id}
            keys={format.keys}
            label={format.name}
            side="top"
          >
            <Button
              aria-keyshortcuts={
                format.keys ? ariaKeyShortcut(format.keys) : undefined
              }
              aria-label={format.name}
              aria-pressed={format.active}
              onClick={format.run}
              onMouseDown={(event) => event.preventDefault()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <format.icon />
            </Button>
          </ShortcutTooltip>
        ))}
        <ShortcutTooltip keys={EDIT_LINK_KEYS} label={t("editLink")} side="top">
          <Button
            aria-keyshortcuts={ariaKeyShortcut(EDIT_LINK_KEYS)}
            aria-label={t("editLink")}
            onClick={() => {
              setEditingLink(!editingLink);
            }}
            onMouseDown={(event) => event.preventDefault()}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Link />
          </Button>
        </ShortcutTooltip>
        {editingLink ? (
          <LinkEditor editor={editor} onDone={() => setEditingLink(false)} />
        ) : null}
      </div>
    </BubbleMenu>
  );
}

function LinkEditor({
  editor,
  onDone,
}: {
  editor: Editor;
  onDone: () => void;
}) {
  const t = useTranslations("textEditor.linkEditor");
  const [url, setUrl] = useState<string>(
    editor.getAttributes("link").href ?? ""
  );
  const [invalid, setInvalid] = useState(false);
  const [selection] = useState(() => ({
    from: editor.state.selection.from,
    to: editor.state.selection.to,
  }));
  useEffect(() => {
    const closeOnEdit = ({
      transaction,
    }: {
      transaction: Editor["state"]["tr"];
    }) => {
      if (transaction.docChanged) {
        onDone();
      }
    };
    editor.on("transaction", closeOnEdit);
    return () => {
      editor.off("transaction", closeOnEdit);
    };
  }, [editor, onDone]);
  const apply = () => {
    if (url && !isSafeExternalUrl(url)) {
      setInvalid(true);
      return;
    }
    const chain = editor
      .chain()
      .focus()
      .setTextSelection(selection)
      .extendMarkRange("link");
    if (url) {
      chain.setLink({ href: url.trim() }).run();
    } else {
      chain.unsetLink().run();
    }
    onDone();
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Input
        aria-invalid={invalid}
        aria-label={t("url")}
        autoFocus
        onChange={(event) => {
          setUrl(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            apply();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onDone();
            editor.commands.focus();
          }
        }}
        placeholder="https://…"
        value={url}
      />
      <Button onClick={apply} size="sm" type="button" variant="ghost">
        {t("apply")}
      </Button>
      {invalid ? (
        <span className="text-destructive text-sm" role="alert">
          {t("invalidUrl")}
        </span>
      ) : null}
    </div>
  );
}
