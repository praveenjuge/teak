import type { CSSProperties } from "react";
import { cn } from "../../lib/utils";

type Stage = "media" | "reading" | "compact";

function stageFor(type?: string): Stage {
  if (
    type === "image" ||
    type === "video" ||
    type === "document" ||
    type === "link"
  ) {
    return "media";
  }
  if (type === "text") {
    return "reading";
  }
  return "compact";
}

export function cardModalFrameClass(type?: string): string {
  const stage = stageFor(type);
  return cn(
    "flex flex-col gap-0 overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none outline-none sm:max-w-none",
    "data-[state=closed]:!animate-none data-[state=open]:duration-150",
    "max-md:data-[state=open]:slide-in-from-bottom max-md:data-[state=open]:zoom-in-100 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:h-[94dvh] max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0",
    stage === "media" &&
      "md:h-[min(56rem,calc(100dvh-4rem))] md:w-[min(82rem,calc(100vw-8rem))]",
    stage === "reading" &&
      "md:h-[min(52rem,calc(100dvh-4rem))] md:w-[min(72rem,calc(100vw-8rem))]",
    stage === "compact" &&
      "md:h-[min(40rem,calc(100dvh-4rem))] md:w-[min(64rem,calc(100vw-8rem))]"
  );
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
