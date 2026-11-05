import { useTranslations } from "@teak/i18n/react";
import { File } from "vadivam-react";
import { cn } from "../../../lib/utils";
import { CARD_BADGE, CARD_TILE } from "../cardDisplay";
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
  const t = useTranslations("cards.previews");
  const badge = formatBadge ? (
    <span className={CARD_BADGE}>{formatBadge}</span>
  ) : null;
  if (thumbnailUrl) {
    return (
      <div className={cn(CARD_TILE, "flex items-end justify-center pt-7")}>
        <div
          className="relative w-[56%] overflow-hidden rounded-t-[4px] bg-white shadow-[0_10px_30px_-10px_rgb(0_0_0/0.35),0_0_0_1px_rgb(0_0_0/0.06)]"
          style={{
            aspectRatio:
              width && height ? width / height : FALLBACK_ASPECT_RATIO,
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
        {badge}
      </div>
    );
  }

  return (
    <div className={cn(CARD_TILE, "flex flex-col p-4 pb-11")}>
      <File aria-hidden="true" className="size-5 text-muted-foreground" />
      <p
        className="mt-auto line-clamp-3 break-words font-semibold text-sm leading-snug"
        dir="auto"
      >
        {fileName}
      </p>
      {badge}
    </div>
  );
}
