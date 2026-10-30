import type { Doc } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";
import { X } from "vadivam-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { copyColorHexToClipboard } from "../../lib/clipboard";
import { AddColorPopover } from "./AddColorPopover";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface PalettePreviewProps {
  card: CardWithUrls;
  /**
   * Hides "Add color" while the palette holds its most colors. An add that is
   * still saving keeps its popover, so a failed save keeps the typed color.
   */
  isFull?: boolean;
  /** Shows "Add color"; left out, the palette can't grow. */
  onAddColor?: (hex: string) => Promise<boolean>;
  /** Shows a way to remove each color; left out when one color is left. */
  onRemoveColor?: (hex: string) => void;
}

export function PalettePreview({
  card,
  isFull = false,
  onAddColor,
  onRemoveColor,
}: PalettePreviewProps) {
  const t = useTranslations("cardPreviews.palette");
  const colors = card.colors || [];

  if (colors.length === 0) {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center gap-4 text-muted-foreground">
        <p>{t("empty")}</p>
        {onAddColor ? (
          <AddColorPopover colors={colors} onAddColor={onAddColor} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4">
      <div className="flex w-full max-w-3xl flex-wrap overflow-hidden rounded-2xl border">
        {colors.map((color) => (
          <PaletteSwatch
            hex={color.hex}
            key={color.hex}
            onRemove={onRemoveColor}
          />
        ))}
      </div>
      {onAddColor ? (
        <AddColorPopover
          colors={colors}
          isFull={isFull}
          onAddColor={onAddColor}
        />
      ) : null}
    </div>
  );
}

interface PaletteSwatchProps {
  hex: string;
  onRemove?: (hex: string) => void;
}

/** One color: a click copies it, and "×" or right-click removes it. */
function PaletteSwatch({ hex, onRemove }: PaletteSwatchProps) {
  const t = useTranslations("cardPreviews.palette");
  const tClipboard = useTranslations("lib.clipboard");

  const swatch = (
    <div className="group relative flex h-32 min-w-24 flex-1 basis-0 md:h-56 md:min-w-28">
      <button
        aria-label={t("copy", { hex })}
        className="flex size-full cursor-pointer items-end justify-center p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        onClick={() => void copyColorHexToClipboard(hex, tClipboard)}
        style={{ backgroundColor: hex }}
        title={t("copy", { hex })}
        type="button"
      >
        <span className="inline-flex h-8 items-center rounded-full bg-background/90 px-3 font-medium text-foreground text-sm tabular-nums shadow-xs transition-colors group-hover:bg-background">
          {hex}
        </span>
      </button>
      {onRemove ? (
        <button
          aria-label={t("remove", { hex })}
          className="absolute top-2 right-2 flex size-7 cursor-pointer items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-xs outline-none transition-opacity hover:bg-background focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          onClick={() => onRemove(hex)}
          title={t("remove", { hex })}
          type="button"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );

  if (!onRemove) {
    return swatch;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{swatch}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onRemove(hex)}>
          {t("removeColor")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
