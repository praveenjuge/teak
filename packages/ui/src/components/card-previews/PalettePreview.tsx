import type { Doc } from "@teak/convex/_generated/dataModel";
import { toast } from "sonner";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface PalettePreviewProps {
  card: CardWithUrls;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${text}`);
  } catch (err) {
    console.error("Failed to copy:", err);
    toast.error("Failed to copy");
  }
}

export function PalettePreview({ card }: PalettePreviewProps) {
  const colors = card.colors || [];

  if (colors.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <p>No colors detected in this palette</p>
      </div>
    );
  }

  // Swatches sit side by side like the grid card and wrap onto new rows when
  // the pane is too narrow for every hex label.
  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="flex w-full max-w-3xl flex-wrap overflow-hidden rounded-2xl border">
        {colors.map((color) => (
          <button
            aria-label={`Copy ${color.hex}`}
            className="group flex h-32 min-w-24 flex-1 basis-0 cursor-pointer items-end justify-center p-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset md:h-56 md:min-w-28"
            key={color.hex}
            onClick={() => void copyToClipboard(color.hex)}
            style={{ backgroundColor: color.hex }}
            title={`Copy ${color.hex}`}
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
