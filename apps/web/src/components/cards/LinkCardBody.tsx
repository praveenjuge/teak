import { doneActionLabel } from "@teak/convex/shared/linkCategories";
import { formatLinkPrice, isLinkPrice } from "@teak/convex/shared/price";
import { useTranslations } from "@teak/i18n/react";
import type { SyntheticEvent } from "react";
import { CircleCheck } from "vadivam-react";
import { linkNoteText } from "../../lib/markdownToPlainText";
import { cn } from "../../lib/utils";
import { CARD_SURFACE, getDisplayHostname } from "./cardDisplay";
import { type LinkCardImage, successfulLinkPreview } from "./linkCardImage";
import { ResilientMediaImage } from "./previews/ResilientMediaImage";
import { SiteFavicon } from "./SiteFavicon";
import type { CardWithUrls } from "./types";

const URL_SCHEME_REGEX = /^https?:\/\/(www\.)?/;

const tileAspectRatio = ({
  width,
  height,
}: {
  height: number;
  width: number;
}) => Math.min(Math.max(width / height, 0.5), 3);

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
  onImageError: (event: SyntheticEvent<HTMLImageElement>) => void;
  textInsets: string;
  title: string;
}) {
  const t = useTranslations("cards.link");
  const hostname = getDisplayHostname(card.url);
  const storedPrice = card.metadata?.linkCategory?.price;
  const priceLabel = isLinkPrice(storedPrice)
    ? formatLinkPrice(storedPrice)
    : undefined;
  const favicon = hostname && (
    <SiteFavicon className="size-4" hostname={hostname} />
  );
  const note = linkNoteText(card.content, { title });
  const noteText = note ? (
    <p className="line-clamp-3 break-words text-sm leading-relaxed" dir="auto">
      {note}
    </p>
  ) : null;
  const doneMark = card.completedAt !== undefined && (
    <CircleCheck
      aria-label={t("markedAs", {
        verb: doneActionLabel(card.metadata?.linkCategory?.category),
      })}
      className="size-4 shrink-0 text-muted-foreground"
      role="img"
    />
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
            decoding="async"
            fetchPriority={isPriority ? "high" : undefined}
            loading={isPriority ? "eager" : "lazy"}
            onPermanentError={onImageError}
            src={image.src}
            storageKey={image.storageKey}
          />
          {priceLabel ? (
            <span className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-background/75 px-2 py-0.5 font-medium text-foreground text-xs tabular-nums shadow-sm ring-1 ring-foreground/10 backdrop-blur-md">
              {priceLabel}
            </span>
          ) : null}
        </div>
        <div className="space-y-1.5 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {favicon}
            <p className="min-w-0 truncate font-medium leading-snug" dir="auto">
              {title}
            </p>
            {doneMark}
          </div>
          {noteText}
        </div>
      </div>
    );
  }

  const titleIsUrl = title === card.url;
  const displayTitle = titleIsUrl ? title.replace(URL_SCHEME_REGEX, "") : title;
  const description =
    successfulLinkPreview(card)?.description ||
    card.metadataDescription ||
    card.aiSummary;
  return (
    <div className={cn(CARD_SURFACE, "space-y-1.5 p-4", textInsets)}>
      <div className="flex min-w-0 items-center gap-2">
        {favicon}
        <p className="min-w-0 truncate font-medium leading-snug" dir="auto">
          {displayTitle}
        </p>
        {doneMark}
        {priceLabel ? (
          <span className="ml-auto max-w-[45%] shrink-0 truncate text-muted-foreground text-sm tabular-nums">
            {priceLabel}
          </span>
        ) : null}
      </div>
      {noteText}
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
