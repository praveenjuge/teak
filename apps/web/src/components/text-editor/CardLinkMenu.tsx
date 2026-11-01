import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  type Rect,
  shift,
  size,
} from "@floating-ui/dom";
import { useTranslations } from "@teak/i18n/react";
import { useEffect, useId, useRef } from "react";
import { getCardTypeIconComponent } from "../card-modal/cardTypeIcon";
import { Button } from "../ui/button";
import type { CardLinkSuggestion } from "./types";

export type CardLinkMenuState =
  | { status: "loading" }
  | { status: "error" }
  | { items: CardLinkSuggestion[]; status: "ready" };

interface CardLinkMenuProps {
  anchor?: { clientRect?: (() => DOMRect | null) | null; dom: HTMLElement };
  onChoose: (item: CardLinkSuggestion) => void;
  query: string;
  selected: number;
  state: CardLinkMenuState;
}

const MESSAGE_CLASS = "px-2 py-1.5 text-muted-foreground text-sm";
const MAX_HEIGHT = 256;
const MIN_HEIGHT = 80;
const AVOID_GAP = 4;

/**
 * The part of the viewport the menu may use: above any of the editor's
 * `[data-editor-avoid]` controls (the composer's Save) that sit below the
 * caret, and below those above it (Focus's top bar), so it never covers them.
 */
export function cardLinkMenuBoundary(
  caret: Pick<DOMRect, "bottom" | "top">,
  avoid: Pick<DOMRect, "bottom" | "height" | "top" | "width">[],
  viewport: { height: number; width: number }
): Rect {
  let top = 0;
  let bottom = viewport.height;
  for (const rect of avoid) {
    if (rect.width === 0 || rect.height === 0) {
      continue;
    }
    if (rect.top >= caret.bottom) {
      bottom = Math.min(bottom, rect.top - AVOID_GAP);
    } else if (rect.bottom <= caret.top) {
      top = Math.max(top, rect.bottom + AVOID_GAP);
    }
  }
  return {
    x: 0,
    y: top,
    width: viewport.width,
    height: Math.max(0, bottom - top),
  };
}

const avoidedRects = (editor: HTMLElement) =>
  Array.from(
    editor
      .closest("form, [role='dialog']")
      ?.querySelectorAll<HTMLElement>("[data-editor-avoid]") ?? [],
    (element) => element.getBoundingClientRect()
  );

export function CardLinkMenu({
  anchor,
  onChoose,
  query,
  selected,
  state,
}: CardLinkMenuProps) {
  const t = useTranslations("textEditor.cardLinkMenu");
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
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
      const boundary = cardLinkMenuBoundary(
        reference.getBoundingClientRect(),
        avoidedRects(anchor.dom),
        { height: window.innerHeight, width: window.innerWidth }
      );
      computePosition(reference, element, {
        placement: "bottom-start",
        strategy: "fixed",
        middleware: [
          offset(4),
          flip({ boundary, padding: 8 }),
          shift({ padding: 16 }),
          size({
            boundary,
            padding: 8,
            apply: ({ availableHeight }) => {
              element.style.maxHeight = `${Math.max(
                MIN_HEIGHT,
                Math.min(MAX_HEIGHT, availableHeight)
              )}px`;
            },
          }),
        ],
      }).then(({ x, y }) => {
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
      });
    });
  }, [anchor]);

  useEffect(() => {
    listRef.current?.children
      .item(selected)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  let message: React.ReactNode = null;
  if (state.status === "loading") {
    message = (
      <div aria-busy="true" className="flex items-center gap-2 px-2 py-2">
        <span className="size-4 animate-pulse rounded bg-muted" />
        <span className="h-3 w-40 animate-pulse rounded-full bg-muted" />
        <span className="sr-only">{t("searching")}</span>
      </div>
    );
  } else if (state.status === "error") {
    message = (
      <p className={MESSAGE_CLASS} role="alert">
        {t("searchFailed")}
      </p>
    );
  } else if (items.length === 0) {
    message = (
      <p className={MESSAGE_CLASS} role="status">
        {query.trim() ? t("noMatches") : t("noCards")}
      </p>
    );
  }

  // The listbox holds only options; loading, empty and error messages sit
  // beside it.
  return (
    <div
      className="fixed z-50 max-h-64 w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      data-slot="card-link-menu"
      ref={ref}
    >
      <div
        aria-label={t("label")}
        data-editor-popup=""
        id={id}
        ref={listRef}
        role="listbox"
      >
        {items.map((item, index) => {
          const Icon = getCardTypeIconComponent(item.type);
          return (
            <Button
              aria-selected={selected === index}
              className="w-full justify-start"
              id={`${id}-${index}`}
              key={item.id}
              onClick={() => {
                onChoose(item);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
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
        })}
      </div>
      {message}
    </div>
  );
}
