import type { Doc } from "@teak/convex/_generated/dataModel";
import { Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";

interface PalettePreviewProps {
  card: Doc<"cards">;
}

export function PalettePreview({ card }: PalettePreviewProps) {
  const [copiedColor, setCopiedColor] = useState<string | null>(null);

  const colors = card.colors || [];

  const copyToClipboard = async (text: string, colorHex: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedColor(colorHex);
      setTimeout(() => setCopiedColor(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
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
      {/* Colors */}
      {colors.map((color, index) => (
        <div className="overflow-hidden rounded" key={`${color.hex}-${index}`}>
          {/* Color Swatch with values inline */}
          <div
            className="flex w-full cursor-pointer items-center justify-end p-2"
            onClick={() => void copyToClipboard(color.hex, color.hex)}
            style={{ backgroundColor: color.hex }}
          >
            <Button
              className="dark:bg-background"
              onClick={(e) => {
                e.stopPropagation();
                void copyToClipboard(color.hex, color.hex);
              }}
              size="sm"
              variant="outline"
            >
              <Copy />
              {copiedColor === color.hex ? "Copied!" : color.hex}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
