"use client";

import { anchorContext } from "@teak/convex/shared/highlights/anchor";
import {
  HIGHLIGHT_NOTE_COUNTER_FROM,
  highlightLength,
  MAX_HIGHLIGHT_NOTE_CHARS,
  MAX_HIGHLIGHTS_PER_CARD,
} from "@teak/convex/shared/highlights/constants";
import { useTranslations } from "@teak/i18n/react";
import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Highlighter, Trash } from "vadivam-react";
import { ShortcutKeys } from "@/components/shortcuts/ShortcutTooltip";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  findOpenHighlight,
  type OpenedHighlight,
} from "@/hooks/cardHighlights";
import type {
  CardHighlight,
  CardHighlightsControl,
} from "@/hooks/useCardHighlights";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import {
  ACTIVE_HIGHLIGHT_NAME,
  type BodyTextIndex,
  canPaintHighlights,
  clipToBody,
  HIGHLIGHT_NAME,
  indexBodyText,
  type PlacedHighlight,
  paintRanges,
  placeHighlights,
  rangeOfSpan,
  spanOfRange,
  textOffsetAtPoint,
} from "./highlightDom";

/** What the card dialog asks of the reader's highlights. */
export interface ReaderHighlightControls {
  /** Hides the selection's button; true when there was one to hide. */
  dismiss: () => boolean;
  /** Highlights the selection (`H`); true when there was one. */
  highlightSelection: () => boolean;
}

export interface HighlightJump {
  id: string;
  /** Changes for every request, so the same highlight can be jumped to again. */
  seq: number;
}

interface Selected {
  end: number;
  left: number;
  quote: string;
  start: number;
  top: number;
}

const BUTTON_WIDTH = 124;
const BUTTON_HEIGHT = 32;
const FLASH_MS = 200;

// Said once per page: the browser lists highlights but can't paint them.
let unsupportedNoticeShown = false;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function NoteEditor({
  highlight,
  onRemove,
  onSave,
}: {
  highlight: CardHighlight;
  onRemove: () => void;
  onSave: (note: string) => void;
}) {
  const t = useTranslations("cardPreviews.highlights");
  const [draft, setDraft] = useState(highlight.note ?? "");
  const used = highlightLength(draft);
  const save = () => onSave(draft);
  // Closing with Esc or a click outside unmounts the field without a blur.
  const latest = useRef({ draft, onSave });
  latest.current = { draft, onSave };
  useEffect(
    () => () => {
      latest.current.onSave(latest.current.draft);
    },
    []
  );
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save();
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        aria-label={t("noteLabel")}
        className="max-h-48 min-h-[4.5rem] resize-none overflow-y-auto"
        maxLength={MAX_HIGHLIGHT_NOTE_CHARS}
        onBlur={save}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t("notePlaceholder")}
        rows={3}
        value={draft}
      />
      <div className="flex items-center justify-between gap-2">
        <Button
          className="-ml-2 text-muted-foreground"
          onClick={onRemove}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Trash />
          {t("remove")}
        </Button>
        {used > HIGHLIGHT_NOTE_COUNTER_FROM ? (
          <span
            aria-live="polite"
            className="text-muted-foreground text-xs tabular-nums"
          >
            {t("noteCount", { count: used, max: MAX_HIGHLIGHT_NOTE_CHARS })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function HighlightButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  const t = useTranslations("cardPreviews.highlights");
  const button = (
    <Button
      aria-keyshortcuts="H"
      className="shadow-md"
      disabled={disabled}
      onClick={onClick}
      // The selection would collapse before the click lands.
      onMouseDown={(event) => event.preventDefault()}
      size="sm"
      type="button"
      variant="secondary"
    >
      <Highlighter />
      {t("highlight")}
      <ShortcutKeys className="ml-0.5" keys={["H"]} />
    </Button>
  );
  if (!disabled) {
    return button;
  }
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex" tabIndex={-1}>
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {t("limitReached", { max: MAX_HIGHLIGHTS_PER_CARD })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * The reader's highlights: painted over the article body with the CSS
 * Custom Highlight API, a button over a selection to make one (or a bar at
 * the bottom on touch), and a note popover (a bottom sheet on touch) for the
 * one clicked.
 */
export function ArticleHighlights({
  articleKey,
  bodyRef,
  control,
  controlsRef,
  jump,
  rootRef,
  version,
}: {
  /** The article the body shows: a highlight's offsets are measured in it. */
  articleKey: string;
  bodyRef: RefObject<HTMLElement | null>;
  control: CardHighlightsControl;
  controlsRef?: RefObject<ReaderHighlightControls | null>;
  jump?: HighlightJump | null;
  rootRef: RefObject<HTMLElement | null>;
  /** Changes whenever the body renders other text. */
  version: string;
}) {
  const t = useTranslations("cardPreviews.highlights");
  const isNarrow = useIsMobile();
  const [touch, setTouch] = useState(false);
  const indexRef = useRef<BodyTextIndex | null>(null);
  const [indexed, setIndexed] = useState(0);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [opened, setOpened] = useState<OpenedHighlight | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const placedRef = useRef<PlacedHighlight[]>([]);
  const creating = useRef(false);
  const highlights = control.highlights ?? [];
  // A highlight opened while its save is still going keeps its note open
  // when the server's row replaces the temporary one.
  const open = findOpenHighlight(highlights, opened);
  const openId = open?._id ?? null;
  // Once its text is no longer highlighted the note is closed for good: a
  // highlight made there later does not open it again.
  useEffect(() => {
    if (opened && !open) {
      setOpened(null);
    }
  }, [opened, open]);
  const useSheet = touch || isNarrow;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` is the body's text changing
  useLayoutEffect(() => {
    const body = bodyRef.current;
    indexRef.current = body ? indexBodyText(body) : null;
    setIndexed((count) => count + 1);
  }, [bodyRef, version]);

  const placed = useMemo(() => {
    const index = indexRef.current;
    return index && indexed > 0
      ? placeHighlights(index.map.text, highlights)
      : [];
  }, [highlights, indexed]);
  placedRef.current = placed;

  const rangeOf = useCallback((id: string | null) => {
    const index = indexRef.current;
    const spot = id ? placedRef.current.find((item) => item.id === id) : null;
    return index && spot ? rangeOfSpan(index, spot.start, spot.end) : null;
  }, []);

  useEffect(() => {
    const index = indexRef.current;
    if (!index) {
      return;
    }
    const ranges = placed.flatMap((spot) => {
      const range = rangeOfSpan(index, spot.start, spot.end);
      return range ? [range] : [];
    });
    paintRanges(HIGHLIGHT_NAME, ranges);
    if (ranges.length > 0 && !canPaintHighlights() && !unsupportedNoticeShown) {
      unsupportedNoticeShown = true;
      toast(t("unsupported"));
    }
  }, [placed, t]);

  const activeId = flashId ?? openId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `placed` moves the active range when the text is indexed again
  useEffect(() => {
    const range = rangeOf(activeId);
    paintRanges(ACTIVE_HIGHLIGHT_NAME, range ? [range] : []);
  }, [activeId, rangeOf, placed]);

  useEffect(
    () => () => {
      paintRanges(HIGHLIGHT_NAME, []);
      paintRanges(ACTIVE_HIGHLIGHT_NAME, []);
    },
    []
  );

  // The selection's button follows the selection inside the body.
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const body = bodyRef.current;
      const root = rootRef.current;
      const index = indexRef.current;
      const selection = window.getSelection();
      if (
        !(body && root && index && selection) ||
        selection.isCollapsed ||
        selection.rangeCount === 0
      ) {
        setSelected(null);
        return;
      }
      const clipped = clipToBody(selection.getRangeAt(0), body);
      const span = clipped ? spanOfRange(index, clipped) : null;
      if (!(clipped && span)) {
        setSelected(null);
        return;
      }
      const rects = clipped.getClientRects();
      const last = rects[rects.length - 1] ?? clipped.getBoundingClientRect();
      const frameRect = root.getBoundingClientRect();
      let top = last.top - frameRect.top - BUTTON_HEIGHT - 8;
      if (top < 0) {
        top = last.bottom - frameRect.top + 8;
      }
      const left = Math.min(
        Math.max(0, last.right - frameRect.left - BUTTON_WIDTH / 2),
        Math.max(0, frameRect.width - BUTTON_WIDTH)
      );
      setSelected({ ...span, left, top });
    };
    const schedule = () => {
      if (!frame) {
        frame = window.requestAnimationFrame(read);
      }
    };
    document.addEventListener("selectionchange", schedule);
    return () => {
      document.removeEventListener("selectionchange", schedule);
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [bodyRef, rootRef]);

  // A click on a highlight, with nothing selected, opens its note.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    const onPointerUp = (event: PointerEvent) => {
      setTouch(event.pointerType === "touch");
      const index = indexRef.current;
      if (!index || window.getSelection()?.isCollapsed === false) {
        return;
      }
      const offset = textOffsetAtPoint(index, event.clientX, event.clientY);
      if (offset === null) {
        return;
      }
      const hit = placedRef.current.find(
        (spot) => spot.start <= offset && offset < spot.end
      );
      if (hit) {
        setOpened({ id: hit.id, start: hit.start, end: hit.end });
      }
    };
    body.addEventListener("pointerup", onPointerUp);
    return () => body.removeEventListener("pointerup", onPointerUp);
  }, [bodyRef]);

  const commit = useCallback((): boolean => {
    const index = indexRef.current;
    if (!(selected && index) || control.isFull || creating.current) {
      return Boolean(selected);
    }
    creating.current = true;
    const span = selected;
    window.getSelection()?.removeAllRanges();
    setSelected(null);
    control
      .create({
        articleKey,
        quote: span.quote,
        start: span.start,
        end: span.end,
        ...anchorContext(index.map.text, span.start, span.end),
      })
      .finally(() => {
        creating.current = false;
      });
    return true;
  }, [articleKey, control, selected]);

  useEffect(() => {
    if (!controlsRef) {
      return;
    }
    controlsRef.current = {
      dismiss: () => {
        if (!selected) {
          return false;
        }
        window.getSelection()?.removeAllRanges();
        setSelected(null);
        return true;
      },
      highlightSelection: commit,
    };
    return () => {
      controlsRef.current = null;
    };
  }, [commit, controlsRef, selected]);

  // A jump from the details panel: into view, then a short flash.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `jump.seq` asks again for the same highlight
  useEffect(() => {
    if (!jump || indexed === 0) {
      return;
    }
    const range = rangeOf(jump.id);
    const target =
      range?.startContainer instanceof Element
        ? range.startContainer
        : range?.startContainer.parentElement;
    if (!target) {
      return;
    }
    target.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
    setFlashId(jump.id);
    const timer = window.setTimeout(() => setFlashId(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [jump?.id, jump?.seq, indexed, rangeOf]);

  const anchorRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () =>
          rangeOf(openId)?.getBoundingClientRect() ?? new DOMRect(),
      },
    }),
    [openId, rangeOf]
  );
  const close = () => setOpened(null);
  const editor = open ? (
    <NoteEditor
      highlight={open}
      key={`${opened?.start}-${opened?.end}`}
      onRemove={() => {
        close();
        void control.remove(open);
      }}
      onSave={(note) => {
        void control.updateNote(open, note);
      }}
    />
  ) : null;

  return (
    <>
      {selected && !useSheet ? (
        <div
          className="absolute z-20"
          style={{ left: selected.left, top: selected.top }}
        >
          <HighlightButton disabled={control.isFull} onClick={commit} />
        </div>
      ) : null}
      {selected && useSheet ? (
        <div className="sticky bottom-0 z-20 -mx-5 mt-6 flex h-12 items-center justify-center border-t bg-background/95 px-5 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <Button
            disabled={control.isFull}
            onClick={commit}
            onMouseDown={(event) => event.preventDefault()}
            size="sm"
            type="button"
            variant="secondary"
          >
            <Highlighter />
            {t("highlight")}
          </Button>
        </div>
      ) : null}
      {useSheet ? (
        <Sheet
          onOpenChange={(next) => {
            if (!next) {
              close();
            }
          }}
          open={Boolean(open)}
        >
          <SheetContent
            className="gap-3 px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            side="bottom"
          >
            <SheetTitle className="pr-8">{t("highlight")}</SheetTitle>
            <SheetDescription className="line-clamp-3 border-[var(--highlight-active)] border-l-2 pl-3">
              {open?.quote}
            </SheetDescription>
            {editor}
          </SheetContent>
        </Sheet>
      ) : (
        <Popover
          onOpenChange={(next) => {
            if (!next) {
              close();
            }
          }}
          open={Boolean(open)}
        >
          <PopoverAnchor virtualRef={anchorRef} />
          <PopoverContent
            aria-label={t("noteLabel")}
            className={cn("w-80 p-3")}
            onOpenAutoFocus={(event) => {
              // Reading the note comes first; typing is a click away.
              if (open?.note) {
                event.preventDefault();
              }
            }}
            side="bottom"
          >
            {editor}
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
