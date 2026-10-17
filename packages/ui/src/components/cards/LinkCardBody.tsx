import { formatLinkPrice, isLinkPrice } from "@teak/convex/shared/price";
import type { SyntheticEvent } from "react";
import { cn } from "../../lib/utils";
import { CARD_SURFACE, getDisplayHostname } from "./cardDisplay";
import { type LinkCardImage, successfulLinkPreview } from "./linkCardImage";
import { ResilientMediaImage } from "./previews/ResilientMediaImage";
import { SiteFavicon } from "./SiteFavicon";
import type { CardWithUrls } from "./types";

const URL_SCHEME_REGEX = /^https?:\/\/(www\.)?/;

/** Keeps very wide or very tall images from making odd tiles. */
const tileAspectRatio = ({
  width,
  height,
}: {
  height: number;
  width: number;
}) => Math.min(Math.max(width / height, 0.5), 3);

/**
 * A link in the grid: its image (when it has one) over the favicon and
 * title, or the title and description on their own.
 */
export function LinkCardBody({
  card,
  image,
  onImageError,
  textInsets,
  title,
}: {
  card: CardWithUrls;
  image: LinkCardImage | undefined;
  onImageError: (event: SyntheticEvent<HTMLImageElement>) => void;
  textInsets: string;
  title: string;
}) {
  const hostname = getDisplayHostname(card.url);
  const storedPrice = card.metadata?.linkCategory?.price;
  const priceLabel = isLinkPrice(storedPrice)
    ? formatLinkPrice(storedPrice)
    : undefined;
  const favicon = hostname && (
    <SiteFavicon className="size-4" hostname={hostname} />
  );

  if (image) {
    return (
      <div className={cn(CARD_SURFACE, "overflow-hidden")}>
        <div
          className={cn(
            "relative w-full overflow-hidden border-b bg-muted",
            !image.size && "h-32 min-h-32"
          )}
          style={
            image.size
              ? { aspectRatio: tileAspectRatio(image.size) }
              : undefined
          }
        >
          <ResilientMediaImage
            alt={title}
            cardId={card._id}
            className="h-full w-full object-cover object-top"
            onPermanentError={onImageError}
            src={image.src}
            storageKey={image.storageKey}
          />
          {/* Frosted so it reads over light and dark images; long amounts truncate. */}
          {priceLabel && (
            <span className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-background/75 px-2 py-0.5 font-medium text-foreground text-xs tabular-nums shadow-sm ring-1 ring-foreground/10 backdrop-blur-md">
              {priceLabel}
            </span>
          )}
        </div>
        <div className="px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {favicon}
            <p className="min-w-0 truncate font-medium leading-snug" dir="auto">
              {title}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const titleIsUrl = title === card.url;
  const description =
    successfulLinkPreview(card)?.description ||
    card.metadataDescription ||
    card.aiSummary;
  return (
    <div className={cn(CARD_SURFACE, "space-y-1.5 p-4", textInsets)}>
      <div className="flex min-w-0 items-center gap-2">
        {favicon}
        <p className="min-w-0 truncate font-medium leading-snug" dir="auto">
          {titleIsUrl ? title.replace(URL_SCHEME_REGEX, "") : title}
        </p>
        {priceLabel && (
          <span className="ml-auto max-w-[45%] shrink-0 truncate text-muted-foreground text-sm tabular-nums">
            {priceLabel}
          </span>
        )}
      </div>
      {description && !titleIsUrl && (
        <p
          className="line-clamp-2 break-words text-muted-foreground text-sm leading-relaxed"
          dir="auto"
        >
          {description}
        </p>
      )}
    </div>
  );
}
