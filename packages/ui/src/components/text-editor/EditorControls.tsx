import { isSafeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { Button } from "@teak/ui/components/ui/button";
import { Input } from "@teak/ui/components/ui/input";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Bold, Code, Italic, Link, Strikethrough } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function EditorFormatting({ editor }: { editor: Editor }) {
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
      name: "Bold",
      icon: Bold,
      active: active.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      name: "Italic",
      icon: Italic,
      active: active.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      name: "Strikethrough",
      icon: Strikethrough,
      active: active.strike,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      name: "Inline code",
      icon: Code,
      active: active.code,
      run: () => editor.chain().focus().toggleCode().run(),
    },
  ];
  useEffect(() => {
    const openLink = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setEditingLink(true);
      }
    };
    editor.view.dom.addEventListener("keydown", openLink);
    return () => editor.view.dom.removeEventListener("keydown", openLink);
  }, [editor]);
  return (
    <BubbleMenu
      editor={editor}
      options={bubbleOptions}
      shouldShow={shouldShow}
      updateDelay={0}
    >
      <div
        aria-label="Text formatting"
        className="teak-editor-formatting flex flex-wrap items-center gap-1 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
        ref={toolbarRef}
        role="toolbar"
      >
        {formats.map((format) => (
          <Button
            aria-label={format.name}
            aria-pressed={format.active}
            key={format.name}
            onClick={format.run}
            onMouseDown={(event) => event.preventDefault()}
            size="icon"
            title={format.name}
            type="button"
            variant="ghost"
          >
            <format.icon />
          </Button>
        ))}
        <Button
          aria-label="Edit link"
          onClick={() => {
            setEditingLink(!editingLink);
          }}
          onMouseDown={(event) => event.preventDefault()}
          size="icon"
          title="Edit link"
          type="button"
          variant="ghost"
        >
          <Link />
        </Button>
        {editingLink && (
          <LinkEditor editor={editor} onDone={() => setEditingLink(false)} />
        )}
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
  const [url, setUrl] = useState<string>(
    editor.getAttributes("link").href ?? ""
  );
  const [invalid, setInvalid] = useState(false);
  const apply = () => {
    if (url && !isSafeExternalUrl(url)) {
      setInvalid(true);
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
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
        aria-label="Link URL"
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
        Apply
      </Button>
      {invalid && (
        <span className="text-destructive text-sm" role="alert">
          Use an http or https link.
        </span>
      )}
    </div>
  );
}
