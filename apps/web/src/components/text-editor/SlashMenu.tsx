import type { SlashCommandSuggestionItem } from "@editorcn/block-editor";
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";
import { englishMessages, type TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import type { SuggestionProps } from "@tiptap/suggestion";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";

type SlashCommandId =
  keyof (typeof englishMessages)["textEditor"]["slashMenu"]["commands"];

const isSlashCommandId = (id: string): id is SlashCommandId =>
  Object.hasOwn(englishMessages.textEditor.slashMenu.commands, id);

/** A slash command's name in the UI language; unknown commands keep theirs. */
export const slashCommandTitle = (
  t: TeakTranslator<"textEditor">,
  item: Pick<SlashCommandSuggestionItem, "id" | "title">
): string =>
  isSlashCommandId(item.id) ? t(`slashMenu.commands.${item.id}`) : item.title;

export function SlashMenu({
  menu,
  selected,
}: {
  menu: SuggestionProps<SlashCommandSuggestionItem>;
  selected: number;
}) {
  const t = useTranslations("textEditor");
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const editor = menu.editor.view.dom;
    if (menu.items[selected]) {
      editor.setAttribute("aria-controls", id);
      editor.setAttribute("aria-activedescendant", `${id}-${selected}`);
    }
    return () => {
      editor.removeAttribute("aria-controls");
      editor.removeAttribute("aria-activedescendant");
    };
  }, [id, menu.editor, menu.items, selected]);
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
      aria-label={t("slashMenu.label")}
      className="fixed z-50 max-h-64 w-64 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      data-editor-popup=""
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
          {slashCommandTitle(t, item)}
        </Button>
      ))}
    </div>
  );
}
