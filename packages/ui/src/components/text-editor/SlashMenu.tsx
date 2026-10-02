import type { SlashCommandSuggestionItem } from "@editorcn/block-editor";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";
import { Button } from "@teak/ui/components/ui/button";
import type { SuggestionProps } from "@tiptap/suggestion";
import { useEffect, useId, useRef } from "react";

export function SlashMenu({
  menu,
  selected,
}: {
  menu: SuggestionProps<SlashCommandSuggestionItem>;
  selected: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const editor = menu.editor.view.dom;
    editor.setAttribute("aria-controls", id);
    editor.setAttribute("aria-activedescendant", `${id}-${selected}`);
    return () => {
      editor.removeAttribute("aria-controls");
      editor.removeAttribute("aria-activedescendant");
    };
  }, [id, menu.editor, selected]);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const anchor = {
      contextElement: menu.editor.view.dom,
      getBoundingClientRect: () => menu.clientRect?.() ?? new DOMRect(),
    };
    return autoUpdate(anchor, element, () => {
      computePosition(anchor, element, {
        placement: "bottom-start",
        strategy: "fixed",
        middleware: [offset(4), flip(), shift({ padding: 16 })],
      }).then(({ x, y }) => {
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
      });
    });
  }, [menu]);
  useEffect(() => {
    ref.current?.children.item(selected)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  if (!menu.items.length) {
    return null;
  }
  return (
    <div
      aria-label="Formatting commands"
      className="fixed z-50 max-h-64 w-64 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      id={id}
      ref={ref}
      role="listbox"
    >
      {menu.items.map((item, index) => (
        <Button
          aria-selected={selected === index}
          className="w-full justify-start"
          id={`${id}-${index}`}
          key={item.id}
          onClick={() => menu.command(item)}
          onMouseDown={(event) => event.preventDefault()}
          role="option"
          type="button"
          variant={selected === index ? "secondary" : "ghost"}
        >
          {item.icon}
          {item.title}
        </Button>
      ))}
    </div>
  );
}
