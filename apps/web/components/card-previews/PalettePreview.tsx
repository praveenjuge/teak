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

  const formatRgb = (rgb: { r: number; g: number; b: number } | undefined) => {
    if (!rgb) return null;
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  };

  const formatHsl = (hsl: { h: number; s: number; l: number } | undefined) => {
    if (!hsl) return null;
    return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
  };

  if (colors.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground">
        <p>No colors detected in this palette</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Original Content */}
      {card.content && <p className="text-muted-foreground">{card.content}</p>}

      {/* Colors */}
      {colors.map((color, index) => (
        <div key={`${color.hex}-${index}`} className="rounded overflow-hidden">
          {/* Color Swatch with values inline */}
          <div
            className="h-8 w-full flex items-center justify-between px-3 cursor-pointer hover:opacity-90 transition-opacity"
            style={{ backgroundColor: color.hex }}
            onClick={() => copyToClipboard(color.hex, color.hex)}
          >
            <span className="font-medium text-xs text-white drop-shadow">
              {copiedColor === color.hex ? "Copied!" : color.hex}
            </span>

            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1 font-mono text-xs text-white hover:bg-white/20"
                onClick={(e) => {
                  e.stopPropagation();
                  copyToClipboard(color.hex, color.hex);
                }}
              >
                <Copy className="w-2 h-2" />
              </Button>

              {color.rgb && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1 font-mono text-xs text-white hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(formatRgb(color.rgb) || "", color.hex);
                  }}
                >
                  RGB
                </Button>
              )}

              {color.hsl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1 font-mono text-xs text-white hover:bg-white/20"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyToClipboard(formatHsl(color.hsl) || "", color.hex);
                  }}
                >
                  HSL
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Notes */}
      {card.notes && (
        <div>
          <h4 className="font-medium mb-1">Notes</h4>
          <p className="text-sm text-muted-foreground">{card.notes}</p>
        </div>
      )}
    </div>
  );
}
