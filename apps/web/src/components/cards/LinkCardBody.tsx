import { formatLinkPrice, isLinkPrice } from "@teak/convex/shared/price";
import { urlHostForDisplay } from "@teak/convex/shared/utils/urlHost";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { ResilientMediaImage, SiteFavicon } from "../media";
import { CardFooter } from "./CardFooter";
import { CARD_FRAME, CARD_PREVIEW, mediaAspectRatio } from "./cardDisplay";
import type { LinkCardImage } from "./linkCardImage";
import type { CardWithUrls } from "./types";

const URL_SCHEME_REGEX = /^https?:\/\/(www\.)?/;

/**
 * A picture much wider than its tile, such as an OG image, stays centered;
 * a taller one, such as a page screenshot, keeps its top.
 */
const WIDE_IMAGE = 1.4;
const isWide = ({ size }: LinkCardImage) =>
  Boolean(size && size.height > 0 && size.width / size.height > WIDE_IMAGE);

export function LinkCardBody({
  card,
  image,
  isPriority = false,
  marks,
  onImageError,
  title,
}: {
  card: CardWithUrls;
  image: LinkCardImage | undefined;
  isPriority?: boolean;
  marks?: ReactNode;
  onImageError: (failedUrl: string) => void;
  title: string;
}) {
  const hostname = urlHostForDisplay(card.url);
  const storedPrice = card.metadata?.linkCategory?.price;
  const priceLabel = isLinkPrice(storedPrice)
    ? formatLinkPrice(storedPrice)
    : undefined;
  const displayTitle =
    title === card.url ? title.replace(URL_SCHEME_REGEX, "") : title;

  return (
    <div className={CARD_FRAME}>
      {image ? (
        <div
          className={cn(CARD_PREVIEW, "card-grid:aspect-(--link-image-ratio)")}
          style={
            {
              "--link-image-ratio": mediaAspectRatio(
                image.size?.width,
                image.size?.height,
                4 / 3
              ),
            } as CSSProperties
          }
        >
          <ResilientMediaImage
            alt={title}
            cardId={card._id}
            className={cn(
              "h-full w-full object-cover",
              isWide(image) ? "object-center" : "object-top"
            )}
            decoding="async"
            fetchPriority={isPriority ? "high" : undefined}
            loading={isPriority ? "eager" : "lazy"}
            onPermanentError={onImageError}
            src={image.src}
            storageKey={image.storageKey}
          />
        </div>
      ) : (
        <div
          className={cn(
            CARD_PREVIEW,
            "flex flex-col items-center justify-center gap-2.5 bg-muted p-4"
          )}
        >
          {hostname ? (
            <>
              <SiteFavicon
                className="size-10 rounded-[10px]"
                hostname={hostname}
              />
              <p
                className="max-w-full truncate text-[13px] text-muted-foreground"
                dir="ltr"
              >
                {hostname}
              </p>
            </>
          ) : null}
        </div>
      )}
      <CardFooter
        detail={priceLabel}
        icon={
          hostname ? (
            <SiteFavicon className="size-4 rounded" hostname={hostname} />
          ) : null
        }
        marks={marks}
        title={displayTitle}
      />
    </div>
  );
}
