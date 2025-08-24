import { type Doc } from "@teak/convex/_generated/dataModel";

interface LinkPreviewProps {
  card: Doc<"cards">;
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

export function LinkPreview({ card }: LinkPreviewProps) {
  const isLoading = card.metadataStatus === "pending";

  // Get metadata with Microlink.io data prioritized, fallback to legacy fields
  const title = card.metadata?.microlinkData?.data?.title || card.url || "Link";
  const description = card.metadata?.microlinkData?.data?.description;
  const image = card.metadata?.microlinkData?.data?.image?.url;
  const favicon = card.metadata?.microlinkData?.data?.logo?.url;
  const publisher = card.metadata?.microlinkData?.data?.publisher;

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

      {/* Notes */}
      {card.notes && (
        <p className="text-base text-muted-foreground whitespace-pre-wrap">
          {card.notes}
        </p>
      )}
    </div>
  );
}
