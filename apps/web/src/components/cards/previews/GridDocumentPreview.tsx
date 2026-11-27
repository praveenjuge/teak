import { useTranslations } from "@teak/i18n/react";
import type { ReactNode } from "react";
import { File } from "vadivam-react";
import { cn } from "../../../lib/utils";
import { ResilientMediaImage } from "../../media";
import { CardFooter } from "../CardFooter";
import { CARD_FRAME, CARD_PREVIEW } from "../cardDisplay";

interface GridDocumentPreviewProps {
  cardId?: string;
  fileName?: string;
  formatBadge?: string;
  height?: number;
  isPriority?: boolean;
  marks?: ReactNode;
  thumbnailKey?: string;
  thumbnailUrl?: string;
  width?: number;
}

const FALLBACK_ASPECT_RATIO = 3 / 4;

export function GridDocumentPreview({
  cardId,
  thumbnailUrl,
  fileName,
  formatBadge,
  width,
  height,
  isPriority = false,
  marks,
  thumbnailKey,
}: GridDocumentPreviewProps) {
  const t = useTranslations("cards.previews");
  return (
    <div className={CARD_FRAME}>
      {thumbnailUrl ? (
        <div
          className={cn(
            CARD_PREVIEW,
            "flex items-end justify-center bg-muted pt-4"
          )}
        >
          <div
            className="relative w-[50%] overflow-hidden rounded-t-[4px] bg-white shadow-[0_10px_30px_-10px_rgb(0_0_0/0.35),0_0_0_1px_rgb(0_0_0/0.06)]"
            style={{
              // A page taller than 3:4 crops from the bottom instead of
              // pushing its top out of the tile.
              aspectRatio: Math.max(
                width && height ? width / height : FALLBACK_ASPECT_RATIO,
                FALLBACK_ASPECT_RATIO
              ),
            }}
          >
            <ResilientMediaImage
              alt={
                fileName
                  ? t("documentPreviewOf", { fileName })
                  : t("documentPreview")
              }
              cardId={cardId}
              className="h-full w-full object-cover object-top"
              decoding="async"
              fetchPriority={isPriority ? "high" : undefined}
              loading={isPriority ? "eager" : "lazy"}
              src={thumbnailUrl}
              storageKey={thumbnailKey}
            />
          </div>
        </div>
      ) : (
        <div
          className={cn(
            CARD_PREVIEW,
            "flex flex-col items-center justify-center gap-2 bg-muted"
          )}
        >
          <File
            aria-hidden="true"
            className="size-9 text-muted-foreground"
            strokeWidth={1.5}
          />
          {formatBadge ? (
            <span className="font-semibold text-muted-foreground text-xs tracking-wide">
              {formatBadge}
            </span>
          ) : null}
        </div>
      )}
      <CardFooter
        detail={formatBadge}
        icon={
          <File aria-hidden="true" className="size-4 text-muted-foreground" />
        }
        marks={marks}
        title={fileName ?? ""}
      />
    </div>
  );
}
