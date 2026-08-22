import { Image } from "antd";
import { File } from "lucide-react";

interface GridDocumentPreviewProps {
  fileName?: string;
  height?: number;
  thumbnailUrl?: string;
  width?: number;
}

// Documents are usually portrait pages; until real dimensions are known,
// reserve a portrait box so lazy-loaded thumbnails don't reflow the grid.
const FALLBACK_ASPECT_RATIO = 3 / 4;

export function GridDocumentPreview({
  thumbnailUrl,
  fileName,
  width,
  height,
}: GridDocumentPreviewProps) {
  if (thumbnailUrl) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <div
          className="relative w-full overflow-hidden"
          style={{
            aspectRatio:
              width && height ? width / height : FALLBACK_ASPECT_RATIO,
          }}
        >
          <Image
            alt={`Preview of ${fileName || "document"}`}
            className="h-full w-full bg-muted object-contain"
            loading="lazy"
            preview={false}
            rootClassName="h-full w-full"
            src={thumbnailUrl}
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
    <div className="flex items-center gap-2 rounded-xl border bg-card p-4">
      <File className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{fileName}</span>
    </div>
  );
}
