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
    "flex flex-col gap-0 overflow-hidden border bg-background p-0 shadow-2xl outline-none sm:max-w-none",
    "data-[state=closed]:!animate-none data-[state=open]:duration-150",
    "max-md:data-[state=open]:slide-in-from-bottom max-md:data-[state=open]:zoom-in-100 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:h-[94dvh] max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0",
    stage === "media" &&
      "md:h-[min(56rem,calc(100dvh-4rem))] md:w-[min(82rem,calc(100vw-4rem))]",
    stage === "reading" &&
      "md:h-[min(52rem,calc(100dvh-4rem))] md:w-[min(70rem,calc(100vw-4rem))]",
    stage === "compact" &&
      "md:h-[min(40rem,calc(100dvh-4rem))] md:w-[min(64rem,calc(100vw-4rem))]"
  );
}

export const CARD_MODAL_OVERLAY_CLASS =
  "data-[state=open]:duration-150 data-[state=closed]:!animate-none";
