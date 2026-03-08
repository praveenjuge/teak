import type { Doc } from "@teak/convex/_generated/dataModel";
import { cn } from "@teak/ui/lib/utils";
import { toast } from "sonner";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface ImagePreviewProps {
  card: CardWithUrls;
}

const TALL_IMAGE_RATIO = 1.5;

export function ImagePreview({ card }: ImagePreviewProps) {
  const fileUrl = card.fileUrl;
  const imageWidth = card.fileMetadata?.width;
  const imageHeight = card.fileMetadata?.height;
  const isTallImage =
    typeof imageWidth === "number" &&
    typeof imageHeight === "number" &&
    imageWidth > 0 &&
    imageHeight / imageWidth >= TALL_IMAGE_RATIO;

  const paletteColors = (card.colors ?? []).slice(0, 5);

  const handleCopyColor = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      toast.success(`Copied ${hex}`);
    } catch (error) {
      console.error("Failed to copy color", error);
      toast.error("Failed to copy");
    }
  };

  if (!fileUrl) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex w-full justify-center",
        isTallImage ? "min-h-full items-start" : "h-full items-center"
      )}
    >
      <div className={cn("relative", isTallImage ? "w-full" : "max-w-full")}>
        <img
          alt={card.content || "Image"}
          className={cn(
            "block overflow-hidden",
            isTallImage
              ? "h-auto w-full object-contain"
              : "max-h-[75vh] max-w-full object-contain"
          )}
          height={imageHeight}
          src={fileUrl}
          width={imageWidth}
        />

        {paletteColors.length > 0 && (
          <div className="absolute bottom-4 left-3 flex items-center gap-2">
            <div className="flex -space-x-2 rounded-full border bg-background p-0.5 transition hover:space-x-px">
              {paletteColors.map((color) => (
                <div
                  className="group relative"
                  key={`palette-${card._id}-${color.hex}`}
                >
                  <button
                    aria-label={color.hex}
                    className="block size-4 shrink-0 cursor-pointer rounded-full transition-transform hover:scale-110"
                    onClick={async (event) => {
                      event.stopPropagation();
                      await handleCopyColor(color.hex);
                    }}
                    style={{ backgroundColor: color.hex }}
                    type="button"
                  />
                  <div className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 transform whitespace-nowrap rounded-full bg-black/75 px-2 py-0.5 text-white text-xs opacity-0 transition-opacity group-hover:opacity-100">
                    {color.hex}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
