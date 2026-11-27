import {
  hostForDisplay,
  normalizeUrlHost,
} from "@teak/convex/shared/utils/urlHost";
import { useTranslations } from "@teak/i18n/react";
import type { ReactNode } from "react";
import { markdownToPlainText } from "../../lib/markdownToPlainText";
import { cn } from "../../lib/utils";
import { CARD_TILE, readableTextOn, splitNotePreview } from "./cardDisplay";
import {
  AudioCardBody,
  DocumentCardBody,
  ImageCardBody,
  VideoCardBody,
} from "./FileCardBody";
import { LinkCardBody } from "./LinkCardBody";
import type { LinkCardImage } from "./linkCardImage";
import type { CardWithUrls } from "./types";

/** Links and documents name themselves in a footer; every other card doesn't. */
export const hasCardFooter = (card: Pick<CardWithUrls, "type">): boolean =>
  card.type === "link" || card.type === "document";

interface CardBodyProps {
  card: CardWithUrls;
  isPriority: boolean;
  link: {
    image: LinkCardImage | undefined;
    onImageError: (failedUrl: string) => void;
    title: string;
  };
  /** The card's marks, for the footer of a card that has one. */
  marks?: ReactNode;
}

export function CardBody({ card, isPriority, link, marks }: CardBodyProps) {
  switch (card.type) {
    case "text":
      return <TextCardBody card={card} />;
    case "quote":
      return <QuoteCardBody card={card} />;
    case "link":
      return (
        <LinkCardBody
          card={card}
          image={link.image}
          isPriority={isPriority}
          marks={marks}
          onImageError={link.onImageError}
          title={link.title}
        />
      );
    case "image":
      return <ImageCardBody card={card} isPriority={isPriority} />;
    case "video":
      return <VideoCardBody card={card} isPriority={isPriority} />;
    case "audio":
      return <AudioCardBody card={card} />;
    case "document":
      return (
        <DocumentCardBody card={card} isPriority={isPriority} marks={marks} />
      );
    case "palette":
      if (card.colors?.length) {
        return <PaletteCardBody colors={card.colors} />;
      }
      break;
    default:
      break;
  }
  return <PlainCardBody card={card} />;
}

/** Words in a tile: 17px for a heading or a short line, 13px for the rest. */
const WORDS_TILE = `${CARD_TILE} flex flex-col p-4`;

function TextCardBody({ card }: { card: CardWithUrls }) {
  const { heading, body } = splitNotePreview(card.content);
  const headingText = markdownToPlainText(heading);
  const bodyText = markdownToPlainText(body) || card.fileMetadata?.fileName;
  const t = useTranslations("cards.body");
  if (!(headingText || bodyText)) {
    return (
      <div className={WORDS_TILE}>
        <p className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground italic">
          {t("emptyNote")}
        </p>
      </div>
    );
  }
  const isShort = !headingText && (bodyText?.length ?? 0) <= SHORT_NOTE;
  return (
    <div className={WORDS_TILE}>
      {isShort ? (
        <p
          className="flex flex-1 items-center text-balance break-words font-semibold text-[17px] leading-snug tracking-[-0.01em]"
          dir="auto"
        >
          {bodyText}
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-1.5 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_65%,transparent)]">
          {headingText ? (
            <p
              className="line-clamp-2 break-words font-semibold text-[17px] leading-snug tracking-[-0.01em]"
              dir="auto"
            >
              {headingText}
            </p>
          ) : null}
          <p
            className={cn(
              "whitespace-pre-line break-words text-[13px] leading-relaxed",
              headingText && "text-muted-foreground"
            )}
            dir="auto"
          >
            {bodyText}
          </p>
        </div>
      )}
      <SourceFooter sourceUrl={card.sourceUrl} />
    </div>
  );
}

/** A note this short and without a heading line is set large. */
const SHORT_NOTE = 80;

function SourceFooter({ sourceUrl }: { sourceUrl?: string }) {
  const host = normalizeUrlHost(sourceUrl);
  return host ? (
    <p className="truncate pt-1.5 text-muted-foreground text-xs" dir="ltr">
      {hostForDisplay(host)}
    </p>
  ) : null;
}

function QuoteCardBody({ card }: { card: CardWithUrls }) {
  const quote = markdownToPlainText(card.content);
  return (
    <figure className={cn(WORDS_TILE, "m-0 justify-center")}>
      <span
        aria-hidden="true"
        className="pointer-events-none h-4 select-none font-bold text-[40px] text-primary leading-[0.75]"
      >
        &ldquo;
      </span>
      <blockquote
        className="m-0 line-clamp-4 text-pretty break-words font-medium text-[17px] leading-snug tracking-[-0.01em]"
        dir="auto"
      >
        {quote}
      </blockquote>
      {card.sourceUrl ? (
        <figcaption>
          <SourceFooter sourceUrl={card.sourceUrl} />
        </figcaption>
      ) : null}
    </figure>
  );
}

function PaletteCardBody({ colors }: { colors: Array<{ hex: string }> }) {
  return (
    <div
      className={cn(
        CARD_TILE,
        "flex border-black/5 bg-transparent dark:border-white/10"
      )}
    >
      {colors.slice(0, 12).map((color, index) => (
        <div
          className="group/swatch flex min-w-0 flex-1 items-end justify-center overflow-hidden pb-2 transition-[flex-grow] duration-300 ease-out hover:flex-[2.6] motion-reduce:transition-none"
          // biome-ignore lint/suspicious/noArrayIndexKey: a palette may repeat a color
          key={`${color.hex}-${index}`}
          style={{
            backgroundColor: color.hex,
            color: readableTextOn(color.hex),
          }}
          title={color.hex}
        >
          <span className="whitespace-nowrap font-medium font-mono text-[10px] uppercase opacity-0 transition-opacity duration-200 group-hover/swatch:opacity-80">
            {color.hex}
          </span>
        </div>
      ))}
    </div>
  );
}

function PlainCardBody({ card }: { card: CardWithUrls }) {
  return (
    <div className={WORDS_TILE}>
      <p
        className="line-clamp-5 break-words font-medium text-[13px]"
        dir="auto"
      >
        {markdownToPlainText(card.content) || card.fileMetadata?.fileName}
      </p>
    </div>
  );
}
