import { File } from "lucide-react";
import { CARD_SURFACE } from "../cardDisplay";
import { ResilientMediaImage } from "./ResilientMediaImage";

interface GridDocumentPreviewProps {
  cardId?: string;
  fileName?: string;
  formatBadge?: string;
  height?: number;
  isPriority?: boolean;
  thumbnailKey?: string;
  thumbnailUrl?: string;
  width?: number;
}

const FALLBACK_ASPECT_RATIO = 3 / 4;

function FileLabel({
  fileName,
  formatBadge,
}: {
  fileName?: string;
  formatBadge?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {formatBadge ? (
        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-semibold text-[10px] text-foreground tracking-wide">
          {formatBadge}
        </span>
      ) : (
        <File className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate font-medium text-sm" dir="auto">
        {fileName}
      </span>
    </div>
  );
}

export function GridDocumentPreview({
  cardId,
  thumbnailUrl,
  fileName,
  formatBadge,
  width,
  height,
  isPriority = false,
  thumbnailKey,
}: GridDocumentPreviewProps) {
  if (thumbnailUrl) {
    return (
      <div className={`overflow-hidden ${CARD_SURFACE}`}>
        <div
          className="relative w-full overflow-hidden bg-muted/60"
          style={{
            aspectRatio:
              width && height ? width / height : FALLBACK_ASPECT_RATIO,
          }}
        >
          <ResilientMediaImage
            alt={`Preview of ${fileName || "document"}`}
            cardId={cardId}
            className="h-full w-full object-contain"
            decoding="async"
            fetchPriority={isPriority ? "high" : undefined}
            loading={isPriority ? "eager" : "lazy"}
            src={thumbnailUrl}
            storageKey={thumbnailKey}
            style={{ objectFit: "contain" }}
          />
        </div>
        <div className="border-t px-4 py-3">
          <FileLabel fileName={fileName} formatBadge={formatBadge} />
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 ${CARD_SURFACE}`}>
      <FileLabel fileName={fileName} formatBadge={formatBadge} />
    </div>
  );
}
