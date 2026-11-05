import {
  hostForDisplay,
  normalizeUrlHost,
} from "@teak/convex/shared/utils/urlHost";
import { useTranslations } from "@teak/i18n/react";
import { markdownToPlainText } from "../../lib/markdownToPlainText";
import { cn } from "../../lib/utils";
import {
  CARD_TILE,
  quoteSizeClass,
  readableTextOn,
  splitNotePreview,
} from "./cardDisplay";
import {
  AudioCardBody,
  DocumentCardBody,
  ImageCardBody,
  VideoCardBody,
} from "./FileCardBody";
import { LinkCardBody } from "./LinkCardBody";
import type { LinkCardImage } from "./linkCardImage";
import type { CardWithUrls } from "./types";

interface CardBodyProps {
  card: CardWithUrls;
  isPriority: boolean;
  link: {
    image: LinkCardImage | undefined;
    onImageError: (failedUrl: string) => void;
    title: string;
  };
  textInsets: string;
}

export function CardBody({
  card,
  isPriority,
  link,
  textInsets,
}: CardBodyProps) {
  switch (card.type) {
    case "text":
      return <TextCardBody card={card} textInsets={textInsets} />;
    case "quote":
      return <QuoteCardBody card={card} textInsets={textInsets} />;
    case "link":
      return (
        <LinkCardBody
          card={card}
          image={link.image}
          isPriority={isPriority}
          onImageError={link.onImageError}
          textInsets={textInsets}
          title={link.title}
        />
      );
    case "image":
      return <ImageCardBody card={card} isPriority={isPriority} />;
    case "video":
      return <VideoCardBody card={card} isPriority={isPriority} />;
    case "audio":
      return <AudioCardBody card={card} textInsets={textInsets} />;
    case "document":
      return <DocumentCardBody card={card} isPriority={isPriority} />;
    case "palette":
      if (card.colors?.length) {
        return <PaletteCardBody colors={card.colors} />;
      }
      break;
    default:
      break;
  }
  return <PlainCardBody card={card} textInsets={textInsets} />;
}

interface TextBodyProps {
  card: CardWithUrls;
  textInsets: string;
}

function TextCardBody({ card, textInsets }: TextBodyProps) {
  const { heading, body } = splitNotePreview(card.content);
  const headingText = markdownToPlainText(heading);
  const bodyText = markdownToPlainText(body) || card.fileMetadata?.fileName;
  const t = useTranslations("cards.body");
  if (!(headingText || bodyText)) {
    return (
      <div className={cn(CARD_TILE, "flex flex-col p-4", textInsets)}>
        <p className="flex flex-1 items-center justify-center text-muted-foreground italic">
          {t("emptyNote")}
        </p>
        <SourceFooter sourceUrl={card.sourceUrl} />
      </div>
    );
  }
  const isShort = !headingText && (bodyText?.length ?? 0) <= SHORT_NOTE;
  return (
    <div className={cn(CARD_TILE, "flex flex-col p-4 pb-3", textInsets)}>
      {isShort ? (
        <p
          className="flex flex-1 items-center text-balance break-words font-semibold text-lg leading-snug tracking-[-0.01em]"
          dir="auto"
        >
          {bodyText}
        </p>
      ) : (
        <div className="min-h-0 flex-1 space-y-1.5 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_55%,transparent_92%)]">
          {headingText ? (
            <p
              className="break-words font-semibold text-[15px] leading-snug"
              dir="auto"
            >
              {headingText}
            </p>
          ) : null}
          <p
            className={cn(
              "whitespace-pre-line break-words text-[13.5px] leading-relaxed",
              headingText ? "text-muted-foreground" : "font-medium"
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

function QuoteCardBody({ card, textInsets }: TextBodyProps) {
  const quote = markdownToPlainText(card.content);
  return (
    <figure
      className={cn(
        CARD_TILE,
        "m-0 flex flex-col justify-center px-4 pt-4 pb-3",
        textInsets
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none h-5 select-none font-serif text-[42px] text-primary leading-[0.6]"
      >
        &ldquo;
      </span>
      <blockquote
        className={cn(
          "line-clamp-5 text-pretty break-words font-serif leading-[1.22] tracking-[-0.01em]",
          quoteSizeClass(quote)
        )}
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

function PlainCardBody({ card, textInsets }: TextBodyProps) {
  return (
    <div className={cn(CARD_TILE, "p-4", textInsets)}>
      <p className="line-clamp-5 break-words font-medium" dir="auto">
        {markdownToPlainText(card.content) || card.fileMetadata?.fileName}
      </p>
    </div>
  );
}
