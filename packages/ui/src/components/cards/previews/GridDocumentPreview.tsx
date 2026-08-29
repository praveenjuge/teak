import { File } from "lucide-react";
import { ResilientMediaImage } from "./ResilientMediaImage";

interface GridDocumentPreviewProps {
  cardId?: string;
  fileName?: string;
  height?: number;
  isPriority?: boolean;
  thumbnailKey?: string;
  thumbnailUrl?: string;
  width?: number;
}

// Documents are usually portrait pages; until real dimensions are known,
// reserve a portrait box so lazy-loaded thumbnails don't reflow the grid.
const FALLBACK_ASPECT_RATIO = 3 / 4;

export function GridDocumentPreview({
  cardId,
  thumbnailUrl,
  fileName,
  width,
  height,
  isPriority = false,
  thumbnailKey,
}: GridDocumentPreviewProps) {
  if (thumbnailUrl) {
    return (
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div
          className="relative w-full overflow-hidden"
          style={{
            aspectRatio:
              width && height ? width / height : FALLBACK_ASPECT_RATIO,
          }}
        >
          <ResilientMediaImage
            alt={`Preview of ${fileName || "document"}`}
            cardId={cardId}
            className="h-full w-full bg-muted object-contain"
            decoding="async"
            fetchPriority={isPriority ? "high" : undefined}
            loading={isPriority ? "eager" : "lazy"}
            src={thumbnailUrl}
            storageKey={thumbnailKey}
            style={{ objectFit: "contain" }}
          />
        </div>
        <div className="flex items-center gap-2 border-t px-4 py-3">
          <File className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-sm">{fileName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border bg-card p-4">
      <File className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{fileName}</span>
    </div>
  );
}
