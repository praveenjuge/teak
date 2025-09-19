import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import { type Doc } from "@teak/convex/_generated/dataModel";

interface LinkPreviewProps {
  card: Doc<"cards">;
  showScreenshot?: boolean;
}

// Loading skeleton components
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

const SkeletonImage = () => (
  <div className="w-full h-48 bg-gray-200 rounded animate-pulse" />
);

export function LinkPreview({
  card,
  showScreenshot = false,
}: LinkPreviewProps) {
  const isLoading = card.metadataStatus === "pending";

  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const legacyMicrolink = card.metadata?.microlinkData?.data;

  const title =
    linkPreview?.title ||
    card.metadataTitle ||
    legacyMicrolink?.title ||
    card.url ||
    "Link";
  const description =
    linkPreview?.description ||
    card.metadataDescription ||
    legacyMicrolink?.description;
  const image = linkPreview?.imageUrl || legacyMicrolink?.image?.url;
  const favicon = linkPreview?.faviconUrl || legacyMicrolink?.logo?.url;
  const publisher =
    linkPreview?.publisher ||
    linkPreview?.siteName ||
    legacyMicrolink?.publisher;

  const screenshotStorageId = linkPreview?.screenshotStorageId;
  const screenshotUrl = useQuery(
    api.cards.getFileUrl,
    showScreenshot && screenshotStorageId
      ? { fileId: screenshotStorageId, cardId: card._id }
      : "skip"
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        {/* Favicon */}
        <div className="w-5 h-5 mt-0.5 flex-shrink-0">
          {isLoading && !favicon ? (
            <div className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={
                favicon ||
                `https://www.google.com/s2/favicons?domain=${card.url}`
              }
              alt=""
              className="w-5 h-5"
              onError={(e) => {
                // Fallback to Google favicon API if custom favicon fails
                const target = e.target as HTMLImageElement;
                if (
                  target.src !==
                  `https://www.google.com/s2/favicons?domain=${card.url}`
                ) {
                  target.src = `https://www.google.com/s2/favicons?domain=${card.url}`;
                }
              }}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* Title */}
          {isLoading && !title ? (
            <SkeletonTitle />
          ) : (
            <h2 className="font-semibold text-lg leading-tight line-clamp-2">
              {title}
            </h2>
          )}

          {/* Description */}
          {isLoading && !description ? (
            <div className="mt-1">
              <SkeletonDescription />
            </div>
          ) : (
            description && (
              <p className="text-muted-foreground text-sm mt-1 line-clamp-2">
                {description}
              </p>
            )
          )}

          {/* Publisher */}
          {publisher && (
            <p className="text-muted-foreground mt-1">{publisher}</p>
          )}
        </div>
      </div>

      {/* OG Image */}
      {isLoading && !image ? (
        <SkeletonImage />
      ) : (
        image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            className="w-full max-h-[60vh] object-cover rounded"
            onError={(e) => {
              // Hide broken images
              const target = e.target as HTMLImageElement;
              target.style.display = "none";
            }}
          />
        )
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

      {/* Notes */}
      {card.notes && (
        <p className="text-base text-muted-foreground whitespace-pre-wrap">
          {card.notes}
        </p>
      )}
    </div>
  );
}
