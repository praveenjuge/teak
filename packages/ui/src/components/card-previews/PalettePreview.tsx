import type { Doc } from "@teak/convex/_generated/dataModel";
import { Button } from "@teak/ui/components/ui/button";
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
      {colors.map((color, index) => (
        <div className="overflow-hidden rounded" key={`${color.hex}-${index}`}>
          <button
            className="flex w-full cursor-pointer items-center justify-end p-2"
            onClick={() => void copyToClipboard(color.hex)}
            style={{ backgroundColor: color.hex }}
            type="button"
          >
            <Button
              className="dark:bg-background"
              onClick={(e) => {
                e.stopPropagation();
                void copyToClipboard(color.hex);
              }}
              size="sm"
              variant="outline"
            >
              <Copy />
              {color.hex}
            </Button>
          </button>
        </div>
      ))}
    </div>
  );
}
