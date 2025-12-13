import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import { type Doc } from "@teak/convex/_generated/dataModel";
import { Image } from "antd";
import { useState } from "react";

interface ImagePreviewProps {
  card: Doc<"cards">;
}

export function ImagePreview({ card }: ImagePreviewProps) {
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId } : "skip"
  );

  const [colorCopyFeedback, setColorCopyFeedback] = useState<{
    color: string;
    state: "copied";
  } | null>(null);

  const paletteColors = (card.colors ?? []).slice(0, 5);

  const handleCopyColor = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setColorCopyFeedback({ color: hex, state: "copied" });
      setTimeout(() => setColorCopyFeedback(null), 1400);
    } catch (error) {
      console.error("Failed to copy color", error);
    }
  };

  if (!fileUrl) return null;

  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative">
        <Image
          src={fileUrl}
          alt={card.content}
          className="max-h-[75vh] max-w-full rounded-xl overflow-hidden"
          preview={false}
          placeholder
        />

        {paletteColors.length > 0 && (
          <div className="absolute bottom-4 left-3 bg-background border rounded-full p-0.5 flex -space-x-2 hover:space-x-px transition">
            {paletteColors.map((color) => (
              <div
                key={`palette-${card._id}-${color.hex}`}
                className="relative group"
              >
                <button
                  className="size-4 rounded-full shrink-0 block cursor-pointer hover:scale-110 transition-transform"
                  style={{ backgroundColor: color.hex }}
                  aria-label={color.hex}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleCopyColor(color.hex);
                  }}
                />
                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-1 px-2 py-0.5 bg-black/75 text-white text-xs rounded-full opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {colorCopyFeedback?.color === color.hex &&
                  colorCopyFeedback.state === "copied"
                    ? "Copied!"
                    : color.hex}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
