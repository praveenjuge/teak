import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "../ui/button";
import { type Doc } from "@teak/convex/_generated/dataModel";

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
      <div className="flex items-center justify-center h-32 text-muted-foreground">
        <p>No colors detected in this palette</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Colors */}
      {colors.map((color, index) => (
        <div key={`${color.hex}-${index}`} className="rounded overflow-hidden">
          {/* Color Swatch with values inline */}
          <div
            className="w-full flex items-center justify-end p-2 cursor-pointer"
            style={{ backgroundColor: color.hex }}
            onClick={() => void copyToClipboard(color.hex, color.hex)}
          >
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                void copyToClipboard(color.hex, color.hex);
              }}
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
