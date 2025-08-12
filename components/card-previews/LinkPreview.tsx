import { type Doc } from "../../convex/_generated/dataModel";

interface LinkPreviewProps {
  card: Doc<"cards">;
}

// Loading skeleton components
const SkeletonLine = ({ width = "100%" }: { width?: string }) => (
  <div 
    className="h-4 bg-gray-200 rounded animate-pulse" 
    style={{ width }}
  />
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

export function LinkPreview({ card }: LinkPreviewProps) {
  const isLoading = card.metadataStatus === "pending";
  const hasFailed = card.metadataStatus === "failed";
  const hasMetadata = card.metadata?.linkTitle || card.metadata?.linkDescription || card.metadata?.linkImage;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        {/* Favicon */}
        <div className="w-5 h-5 mt-0.5 flex-shrink-0">
          {isLoading && !card.metadata?.linkFavicon ? (
            <div className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.metadata?.linkFavicon || `https://www.google.com/s2/favicons?domain=${card.url}`}
              alt=""
              className="w-5 h-5"
              onError={(e) => {
                // Fallback to Google favicon API if custom favicon fails
                const target = e.target as HTMLImageElement;
                if (target.src !== `https://www.google.com/s2/favicons?domain=${card.url}`) {
                  target.src = `https://www.google.com/s2/favicons?domain=${card.url}`;
                }
              }}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {/* Title */}
          {isLoading && !card.metadata?.linkTitle ? (
            <SkeletonTitle />
          ) : (
            <h2 className="font-semibold text-lg leading-tight line-clamp-2">
              {card.metadata?.linkTitle || card.url || "Link"}
            </h2>
          )}

          {/* Description */}
          {isLoading && !card.metadata?.linkDescription ? (
            <div className="mt-1">
              <SkeletonDescription />
            </div>
          ) : (
            card.metadata?.linkDescription && (
              <p className="text-muted-foreground text-sm mt-1 line-clamp-2">
                {card.metadata.linkDescription}
              </p>
            )
          )}

          {/* URL - always show */}
          {card.url && (
            <p className="text-muted-foreground text-xs mt-1 truncate">{card.url}</p>
          )}
        </div>
      </div>

      {/* OG Image */}
      {isLoading && !card.metadata?.linkImage ? (
        <SkeletonImage />
      ) : (
        card.metadata?.linkImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.metadata.linkImage}
            alt=""
            className="w-full max-h-[60vh] object-cover rounded"
            onError={(e) => {
              // Hide broken images
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
            }}
          />
        )
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