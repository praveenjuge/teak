import { type CSSProperties, useState } from "react";
import { cn } from "../../lib/utils";

type Stage = "media" | "reading" | "note" | "compact";

/** A note up to this long opens in a smaller frame that fits it. */
export const SHORT_NOTE_MAX_CHARS = 280;
const SHORT_NOTE_MAX_LINES = 6;

interface FramedCard {
  content?: string;
  type?: string;
}

export function isShortNote(card?: FramedCard | null): boolean {
  if (card?.type !== "text") {
    return false;
  }
  const content = card.content?.trim() ?? "";
  return (
    content.length <= SHORT_NOTE_MAX_CHARS &&
    content.split("\n").length <= SHORT_NOTE_MAX_LINES
  );
}

function stageFor(card?: FramedCard | null, shortNote?: boolean): Stage {
  const type = card?.type;
  if (
    type === "image" ||
    type === "video" ||
    type === "document" ||
    type === "link"
  ) {
    return "media";
  }
  if (type === "text") {
    return (shortNote ?? isShortNote(card)) ? "note" : "reading";
  }
  return "compact";
}

/**
 * The dialog's size for a card. `shortNote` holds a note's size while it's
 * being edited, so the dialog doesn't resize under the cursor.
 */
export function cardModalFrameClass(
  card?: FramedCard | null,
  shortNote?: boolean
): string {
  const stage = stageFor(card, shortNote);
  return cn(
    "flex flex-col gap-0 overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none outline-none sm:max-w-none",
    "data-[state=closed]:!animate-none data-[state=open]:duration-150",
    "max-md:data-[state=open]:slide-in-from-bottom max-md:data-[state=open]:zoom-in-100 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:h-[94dvh] max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0",
    stage === "media" &&
      "md:h-[min(56rem,calc(100dvh-4rem))] md:w-[min(82rem,calc(100vw-8rem))]",
    stage === "reading" &&
      "md:h-[min(52rem,calc(100dvh-4rem))] md:w-[min(72rem,calc(100vw-8rem))]",
    stage === "note" &&
      "md:h-[min(30rem,calc(100dvh-4rem))] md:w-[min(56rem,calc(100vw-8rem))]",
    stage === "compact" &&
      "md:h-[min(40rem,calc(100dvh-4rem))] md:w-[min(64rem,calc(100vw-8rem))]"
  );
}

/**
 * The frame for the open card, sized once per card: a short note keeps its
 * smaller frame while it grows under the cursor, until another card opens.
 */
export function useCardModalFrameClass(
  card?: (FramedCard & { _id: string }) | null
): string {
  const [sized, setSized] = useState<{ id?: string; short: boolean }>({
    short: false,
  });
  const short =
    sized.id === card?._id && sized.id !== undefined
      ? sized.short
      : isShortNote(card);
  if (sized.id !== card?._id) {
    setSized({ id: card?._id, short });
  }
  return cardModalFrameClass(card, short);
}

/**
 * Half the widest card (link, image, video, document). Every card is centered,
 * so the controls beside it measure from the center by this much and stay in
 * one place as narrower cards come and go, ready for the next quick click.
 */
const WIDEST_HALF_WIDTH = "min(41rem, 50vw - 4rem)";
const TALLEST_HALF_HEIGHT = "min(28rem, 50dvh - 2rem)";

export function gutterNavStyle(side: "left" | "right"): CSSProperties {
  return { [side]: `calc(50% - ${WIDEST_HALF_WIDTH} - 3.5rem)` };
}

export const GUTTER_CLOSE_STYLE: CSSProperties = {
  right: `calc(50% - ${WIDEST_HALF_WIDTH} - 3.375rem)`,
  top: `calc(50% - ${TALLEST_HALF_HEIGHT})`,
};

export const CARD_MODAL_SURFACE_CLASS =
  "relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0";

export const CARD_MODAL_OVERLAY_CLASS =
  "data-[state=open]:duration-150 data-[state=closed]:!animate-none";
