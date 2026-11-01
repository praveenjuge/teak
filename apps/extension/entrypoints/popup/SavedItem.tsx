import { useIntlLocale } from "@teak/i18n/react";
import { type ReactNode, useEffect, useState } from "react";
import {
  AudioLines,
  File,
  FileText,
  Globe,
  Image,
  type VadivamIcon,
  Video,
} from "vadivam-react";
import type { PopupStatus, SavedItem } from "../../lib/popupStatus";
import { cn } from "../../lib/utils";
import { TONES } from "./tones";

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const fileIcon = (mimeType: string): VadivamIcon => {
  if (mimeType.startsWith("image/")) {
    return Image;
  }
  if (mimeType.startsWith("video/")) {
    return Video;
  }
  if (mimeType.startsWith("audio/")) {
    return AudioLines;
  }
  if (mimeType === "application/pdf" || mimeType.startsWith("text/")) {
    return FileText;
  }
  return File;
};

const fileSize = (bytes: number, locale?: string) => {
  const [unit, value] =
    bytes >= 1_000_000
      ? (["megabyte", bytes / 1_000_000] as const)
      : (["kilobyte", Math.max(bytes / 1000, 1)] as const);
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: value < 10 ? 1 : 0,
    style: "unit",
    unit,
    unitDisplay: "short",
  }).format(value);
};

/** One line that says where the save stands: an icon in the status's tone, then its title. */
export function StatusLine({ status }: { status: PopupStatus }) {
  const { chip, icon: Icon, text } = TONES[status.tone];
  return (
    <p
      aria-live="polite"
      className={cn("flex items-center gap-2 px-1 font-medium text-sm", text)}
      role="status"
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full",
          chip,
          status.tone === "loading"
            ? null
            : "starting:scale-50 transition-transform duration-300 ease-out"
        )}
      >
        <Icon aria-hidden="true" className="size-3" strokeWidth={3} />
      </span>
      {status.title}
    </p>
  );
}

/**
 * Whether the page's icon loads, so a broken one falls back to a globe and a
 * slow one leaves the tile empty instead of flashing the globe first.
 */
function useIconState(src?: string): "failed" | "loaded" | "loading" {
  // The icon that last finished loading, and how it went.
  const [settled, setSettled] = useState<{
    src?: string;
    state: "failed" | "loaded";
  }>({ state: "failed" });
  useEffect(() => {
    if (!src) {
      return;
    }
    const image = new window.Image();
    image.onload = () => setSettled({ src, state: "loaded" });
    image.onerror = () => setSettled({ src, state: "failed" });
    image.src = src;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [src]);
  if (!src) {
    return "failed";
  }
  return settled.src === src ? settled.state : "loading";
}

function PageThumb({ favIconUrl }: { favIconUrl?: string }) {
  const state = useIconState(favIconUrl);
  if (state === "loading") {
    return null;
  }
  return state === "loaded" ? (
    <img
      alt=""
      className="size-5 rounded-sm starting:opacity-0 transition-opacity"
      height={20}
      src={favIconUrl}
      width={20}
    />
  ) : (
    <Globe aria-hidden="true" className="size-5 text-muted-foreground" />
  );
}

/**
 * The page or file being saved, drawn like a card in the library, with its
 * tags and note (`children`) under a divider in the same card.
 */
export function SavedItemCard({
  busy,
  children,
  item,
}: {
  busy: boolean;
  children?: ReactNode;
  item: SavedItem;
}) {
  const locale = useIntlLocale();
  const FileIcon = item.kind === "file" ? fileIcon(item.mimeType) : undefined;
  const title =
    item.kind === "page" ? item.title?.trim() || hostOf(item.url) : item.name;
  const caption =
    item.kind === "page" ? hostOf(item.url) : fileSize(item.size, locale);
  return (
    <div className="overflow-hidden rounded-2xl border bg-card text-left">
      <div className="relative flex items-center gap-3 p-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted">
          {FileIcon ? (
            <FileIcon aria-hidden="true" className="size-5 text-primary" />
          ) : (
            <PageThumb
              favIconUrl={item.kind === "page" ? item.favIconUrl : undefined}
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="line-clamp-2 break-words font-medium leading-snug"
            dir="auto"
            title={title}
          >
            {title}
          </p>
          <p className="mt-0.5 truncate text-muted-foreground text-xs">
            {caption}
          </p>
        </div>
        {busy ? (
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-primary/10"
          >
            <span className="block h-full w-1/3 animate-[teak-progress_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
          </span>
        ) : null}
      </div>
      {children ? <div className="border-t">{children}</div> : null}
    </div>
  );
}
