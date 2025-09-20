import { useMemo } from "react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import { type Doc } from "@teak/convex/_generated/dataModel";
import { Separator } from "@/components/ui/separator";

interface LinkPreviewProps {
  card: Doc<"cards">;
  showScreenshot?: boolean;
}

const SkeletonLine = ({ width = "100%" }: { width?: string }) => (
  <div className="h-4 bg-gray-200 rounded animate-pulse" style={{ width }} />
);

const SkeletonTitle = () => (
  <div className="space-y-2">
    <SkeletonLine width="85%" />
    <SkeletonLine width="60%" />
  </div>
);

const SkeletonDescription = () => (
  <div className="space-y-1.5">
    <SkeletonLine width="95%" />
    <SkeletonLine width="80%" />
  </div>
);


const stagePending = (stage?: { status?: string }) =>
  stage?.status === "pending" || stage?.status === "in_progress";

export function LinkPreview({
  card,
  showScreenshot = false,
}: LinkPreviewProps) {
  const processingStatus = card.processingStatus;
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const legacyMicrolink = card.metadata?.microlinkData?.data;

  const linkTitle =
    linkPreview?.title ||
    card.metadataTitle ||
    legacyMicrolink?.title ||
    card.url ||
    "Link";
  const linkDescription =
    linkPreview?.description ||
    card.metadataDescription ||
    legacyMicrolink?.description;
  const linkImage = linkPreview?.imageUrl || legacyMicrolink?.image?.url;
  const linkFavicon = linkPreview?.faviconUrl || legacyMicrolink?.logo?.url;

  const screenshotStorageId = linkPreview?.screenshotStorageId;
  const screenshotUrl = useQuery(
    api.cards.getFileUrl,
    showScreenshot && screenshotStorageId
      ? { fileId: screenshotStorageId, cardId: card._id }
      : "skip"
  );

  // Only wait for AI classification and categorization to complete
  // Don't wait for metadata extraction or thumbnail generation (renderables)
  const isAIProcessingPending =
    stagePending(processingStatus?.classify) ||
    stagePending(processingStatus?.categorize);

  const isAnalyzing = isAIProcessingPending;

  const faviconUrl = useMemo(() => {
    if (linkFavicon) return linkFavicon;
    if (!card.url) return undefined;
    return `https://www.google.com/s2/favicons?domain=${card.url}`;
  }, [card.url, linkFavicon]);

  const categoryMetadata = card.metadata?.linkCategory;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <div className="w-5 h-5 mt-0.5 flex-shrink-0">
          {isAnalyzing && !faviconUrl ? (
            <div className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
          ) : (
            faviconUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={faviconUrl}
                alt=""
                className="w-5 h-5"
                onError={(event) => {
                  const target = event.currentTarget;
                  if (card.url && !target.dataset.fallback) {
                    target.dataset.fallback = "true";
                    target.src = `https://www.google.com/s2/favicons?domain=${card.url}`;
                  } else {
                    target.style.display = "none";
                  }
                }}
              />
            )
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {isAnalyzing && !linkTitle ? (
            <SkeletonTitle />
          ) : (
            <h2 className="font-semibold text-lg leading-tight line-clamp-2">
              {linkTitle}
            </h2>
          )}

          {isAnalyzing && !linkDescription ? (
            <SkeletonDescription />
          ) : (
            linkDescription && (
              <p className="text-muted-foreground text-sm line-clamp-3">
                {linkDescription}
              </p>
            )
          )}

          {categoryMetadata?.facts?.length ? (
            <div className="space-y-1 text-sm text-muted-foreground border-t pt-3">
              {categoryMetadata.facts.map((fact) => (
                <div key={`${fact.label}-${fact.value}`} className="flex gap-2">
                  <span className="font-medium text-foreground">
                    {fact.label}:
                  </span>
                  <span className="text-balance">{fact.value}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {linkImage && !linkPreview?.imageUrl && <Separator />}

      {!isAnalyzing && linkImage && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Preview Image
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={linkImage}
            alt="Open Graph preview"
            className="w-full max-h-[70vh] object-contain rounded border"
            onError={(event) => {
              const target = event.currentTarget;
              target.style.display = "none";
            }}
          />
        </div>
      )}

      {showScreenshot && screenshotUrl && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Screenshot
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={screenshotUrl}
            alt="Rendered webpage screenshot"
            className="w-full max-h-[70vh] object-contain rounded border"
          />
        </div>
      )}

      {card.notes && (
        <div className="space-y-2">
          <Separator />
          <p className="text-base text-muted-foreground whitespace-pre-wrap">
            {card.notes}
          </p>
        </div>
      )}
    </div>
  );
}
