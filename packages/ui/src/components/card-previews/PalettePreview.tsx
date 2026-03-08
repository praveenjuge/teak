import type { Doc } from "@teak/convex/_generated/dataModel";
import { buttonVariants } from "@teak/ui/components/ui/button";
import { cn } from "@teak/ui/lib/utils";
import { Copy } from "lucide-react";
import { toast } from "sonner";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface PalettePreviewProps {
  card: CardWithUrls;
}

export function PalettePreview({ card }: PalettePreviewProps) {
  const colors = card.colors || [];

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${text}`);
    } catch (err) {
      console.error("Failed to copy:", err);
      toast.error("Failed to copy");
    }
  };

  if (colors.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <p>No colors detected in this palette</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {colors.map((color) => (
        <div className="overflow-hidden rounded-lg" key={`${color.hex}`}>
          <button
            className="flex w-full cursor-pointer items-center justify-end rounded-lg border border-black/10 p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
            onClick={() => void copyToClipboard(color.hex)}
            style={{ backgroundColor: color.hex }}
            type="button"
          >
            <span
              className={cn(
                buttonVariants({ size: "sm", variant: "outline" }),
                "pointer-events-none border-0 dark:bg-background"
              )}
            >
              <Copy />
              {color.hex}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}
