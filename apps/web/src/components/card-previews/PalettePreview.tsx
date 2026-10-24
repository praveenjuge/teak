import type { Doc } from "@teak/convex/_generated/dataModel";
import { useTranslations } from "@teak/i18n/react";
import { toast } from "sonner";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface PalettePreviewProps {
  card: CardWithUrls;
}

async function copyToClipboard(
  text: string,
  messages: { copied: string; failed: string }
) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(messages.copied);
  } catch (err) {
    console.error("Failed to copy:", err);
    toast.error(messages.failed);
  }
}

export function PalettePreview({ card }: PalettePreviewProps) {
  const t = useTranslations("cardPreviews.palette");
  const colors = card.colors || [];

  if (colors.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <p>{t("empty")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="flex w-full max-w-3xl flex-wrap overflow-hidden rounded-2xl border">
        {colors.map((color) => (
          <button
            aria-label={t("copy", { hex: color.hex })}
            className="group flex h-32 min-w-24 flex-1 basis-0 cursor-pointer items-end justify-center p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset md:h-56 md:min-w-28"
            key={color.hex}
            onClick={() =>
              void copyToClipboard(color.hex, {
                copied: t("copied", { hex: color.hex }),
                failed: t("copyFailed"),
              })
            }
            style={{ backgroundColor: color.hex }}
            title={t("copy", { hex: color.hex })}
            type="button"
          >
            <span className="inline-flex h-8 items-center rounded-full bg-background/90 px-3 font-medium text-foreground text-sm tabular-nums shadow-xs transition-colors group-hover:bg-background">
              {color.hex}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
