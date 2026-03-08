import type { Doc } from "@teak/convex/_generated/dataModel";
import { cn } from "@teak/ui/lib/utils";

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
      </div>
    </div>
  );
}
