import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
} from "@floating-ui/dom";
import type { CardType } from "@teak/convex/shared/constants";
import { useEffect, useId, useRef } from "react";
import { getCardTypeIconComponent } from "../card-modal/cardTypeIcon";
import { Button } from "../ui/button";
import type { CardLinkSuggestion } from "./types";

export type CardLinkMenuState =
  | { status: "loading" }
  | { status: "error" }
  | { items: CardLinkSuggestion[]; status: "ready" };

interface CardLinkMenuProps {
  /** Where the `[[` is, for placing the menu; absent in static renders. */
  anchor?: { clientRect?: (() => DOMRect | null) | null; dom: HTMLElement };
  onChoose: (item: CardLinkSuggestion) => void;
  query: string;
  selected: number;
  state: CardLinkMenuState;
}

const MESSAGE_CLASS = "px-2 py-1.5 text-muted-foreground text-sm";

/** The `[[` menu: cards to link, with loading, empty and error rows. */
export function CardLinkMenu({
  anchor,
  onChoose,
  query,
  selected,
  state,
}: CardLinkMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const items = state.status === "ready" ? state.items : [];

  useEffect(() => {
    const editor = anchor?.dom;
    if (!(editor && items[selected])) {
      return;
    }
    editor.setAttribute("aria-controls", id);
    editor.setAttribute("aria-activedescendant", `${id}-${selected}`);
    return () => {
      editor.removeAttribute("aria-controls");
      editor.removeAttribute("aria-activedescendant");
    };
  }, [anchor, id, items, selected]);

  useEffect(() => {
    const element = ref.current;
    if (!(element && anchor)) {
      return;
    }
    const reference = {
      contextElement: anchor.dom,
      getBoundingClientRect: () => anchor.clientRect?.() ?? new DOMRect(),
    };
    return autoUpdate(reference, element, () => {
      computePosition(reference, element, {
        placement: "bottom-start",
        strategy: "fixed",
        middleware: [offset(4), flip(), shift({ padding: 16 })],
      }).then(({ x, y }) => {
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
      });
    });
  }, [anchor]);

  useEffect(() => {
    ref.current?.children.item(selected)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  let body: React.ReactNode;
  if (state.status === "loading") {
    body = (
      <div aria-busy="true" className="flex items-center gap-2 px-2 py-2">
        <span className="size-4 animate-pulse rounded bg-muted" />
        <span className="h-3 w-40 animate-pulse rounded-full bg-muted" />
        <span className="sr-only">Searching cards…</span>
      </div>
    );
  } else if (state.status === "error") {
    body = (
      <p className={MESSAGE_CLASS} role="alert">
        Couldn't search cards
      </p>
    );
  } else if (items.length === 0) {
    body = (
      <p className={MESSAGE_CLASS}>
        {query.trim() ? "No matching cards" : "No cards yet"}
      </p>
    );
  } else {
    body = items.map((item, index) => {
      const Icon = getCardTypeIconComponent(item.type as CardType);
      return (
        <Button
          aria-selected={selected === index}
          className="w-full justify-start"
          id={`${id}-${index}`}
          key={item.id}
          onClick={() => onChoose(item)}
          onMouseDown={(event) => event.preventDefault()}
          role="option"
          title={item.title}
          type="button"
          variant={selected === index ? "secondary" : "ghost"}
        >
          <Icon aria-hidden className="text-muted-foreground" />
          <span className="min-w-0 truncate" dir="auto">
            {item.title}
          </span>
        </Button>
      );
    });
  }

  return (
    <div
      aria-label="Link a card"
      className="fixed z-50 max-h-64 w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      data-slot="card-link-menu"
      id={id}
      ref={ref}
      role="listbox"
    >
      {body}
    </div>
  );
}
