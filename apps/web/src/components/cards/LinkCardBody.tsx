import { doneActionLabel } from "@teak/convex/shared/linkCategories";
import { formatLinkPrice, isLinkPrice } from "@teak/convex/shared/price";
import { useTranslations } from "@teak/i18n/react";
import { CircleCheck } from "vadivam-react";
import { cn } from "../../lib/utils";
import { CARD_BADGE, CARD_TILE, getDisplayHostname } from "./cardDisplay";
import type { LinkCardImage } from "./linkCardImage";
import { ResilientMediaImage } from "./previews/ResilientMediaImage";
import { SiteFavicon } from "./SiteFavicon";
import type { CardWithUrls } from "./types";

const URL_SCHEME_REGEX = /^https?:\/\/(www\.)?/;

/**
 * A page screenshot or banner much wider than the tile keeps its top left,
 * where a page's name and heading start, instead of losing both edges.
 */
const WIDE_IMAGE = 1.4;
const isWide = ({ size }: LinkCardImage) =>
  Boolean(size && size.height > 0 && size.width / size.height > WIDE_IMAGE);

export function LinkCardBody({
  card,
  image,
  isPriority = false,
  onImageError,
  textInsets,
  title,
}: {
  card: CardWithUrls;
  image: LinkCardImage | undefined;
  isPriority?: boolean;
  onImageError: (failedUrl: string) => void;
  textInsets: string;
  title: string;
}) {
  const t = useTranslations("cards.link");
  const hostname = getDisplayHostname(card.url);
  const storedPrice = card.metadata?.linkCategory?.price;
  const priceLabel = isLinkPrice(storedPrice)
    ? formatLinkPrice(storedPrice)
    : undefined;
  const titleIsUrl = title === card.url;
  const displayTitle = titleIsUrl ? title.replace(URL_SCHEME_REGEX, "") : title;
  const doneMark = card.completedAt !== undefined && (
    <CircleCheck
      aria-label={t("markedAs", {
        verb: doneActionLabel(card.metadata?.linkCategory?.category),
      })}
      className="size-4 shrink-0 text-muted-foreground"
      role="img"
    />
  );

  return (
    <div>
      {image ? (
        <div className={CARD_TILE}>
          <ResilientMediaImage
            alt={title}
            cardId={card._id}
            className={cn(
              "h-full w-full object-cover",
              isWide(image) ? "object-left-top" : "object-top"
            )}
            decoding="async"
            fetchPriority={isPriority ? "high" : undefined}
            loading={isPriority ? "eager" : "lazy"}
            onPermanentError={onImageError}
            src={image.src}
            storageKey={image.storageKey}
          />
          {priceLabel ? <span className={CARD_BADGE}>{priceLabel}</span> : null}
        </div>
      ) : (
        <div
          className={cn(
            CARD_TILE,
            "flex flex-col p-4",
            priceLabel && "pb-11",
            textInsets
          )}
        >
          {hostname ? (
            <SiteFavicon
              className="size-[22px] rounded-md"
              hostname={hostname}
            />
          ) : null}
          <div className="mt-auto min-w-0">
            <p
              className={cn(
                "text-balance break-words font-serif text-[21px] leading-[1.12] tracking-[-0.015em]",
                priceLabel ? "line-clamp-2" : "line-clamp-3"
              )}
              dir="auto"
            >
              {displayTitle}
            </p>
            {hostname ? (
              <p
                className="mt-2 truncate text-muted-foreground text-xs"
                dir="ltr"
              >
                {hostname}
              </p>
            ) : null}
          </div>
          {priceLabel ? <span className={CARD_BADGE}>{priceLabel}</span> : null}
        </div>
      )}
      <div className="mt-2.5 flex min-w-0 items-center gap-2 px-0.5">
        {hostname ? (
          <SiteFavicon className="size-4 rounded" hostname={hostname} />
        ) : null}
        <p
          className="min-w-0 flex-1 truncate font-medium text-[13px] leading-snug"
          dir="auto"
        >
          {displayTitle}
        </p>
        {doneMark}
      </div>
    </div>
  );
}
