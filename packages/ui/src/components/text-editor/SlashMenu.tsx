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
import { useEffect, useRef } from "react";

export function SlashMenu({
  menu,
  selected,
}: {
  menu: SuggestionProps<SlashCommandSuggestionItem>;
  selected: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
      aria-label="Insert block"
      className="fixed z-50 max-h-64 w-64 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      ref={ref}
      role="toolbar"
    >
      {menu.items.map((item, index) => (
        <Button
          aria-pressed={selected === index}
          className="w-full justify-start"
          key={item.id}
          onClick={() => menu.command(item)}
          onMouseDown={(event) => event.preventDefault()}
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
