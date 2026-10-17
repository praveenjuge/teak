import type { SyntheticEvent } from "react";
import { markdownToPlainText } from "../../lib/markdownToPlainText";
import { cn } from "../../lib/utils";
import { CARD_SURFACE, readableTextOn, splitNotePreview } from "./cardDisplay";
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
    onImageError: (event: SyntheticEvent<HTMLImageElement>) => void;
    title: string;
  };
  /** Room kept clear on text tiles for the favorite mark. */
  textInsets: string;
}

/** What a card shows in the grid, by its type. */
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
      return <AudioCardBody card={card} />;
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

/** A note: its first line as a heading over the rest, or just its text. */
function TextCardBody({ card, textInsets }: TextBodyProps) {
  const { heading, body } = splitNotePreview(card.content);
  const headingText = markdownToPlainText(heading);
  const bodyText = markdownToPlainText(body) || card.fileMetadata?.fileName;
  return (
    <div className={cn(CARD_SURFACE, "space-y-1.5 p-4", textInsets)}>
      {headingText ? (
        <>
          <p
            className="line-clamp-2 break-words font-semibold leading-snug"
            dir="auto"
          >
            {headingText}
          </p>
          <p
            className="line-clamp-5 break-words text-muted-foreground text-sm leading-relaxed"
            dir="auto"
          >
            {bodyText}
          </p>
        </>
      ) : (
        <p
          className="line-clamp-6 break-words font-medium leading-relaxed"
          dir="auto"
        >
          {bodyText}
        </p>
      )}
    </div>
  );
}

function QuoteCardBody({ card, textInsets }: TextBodyProps) {
  return (
    <figure className={cn(CARD_SURFACE, "relative px-5 pt-8 pb-5", textInsets)}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-3 left-4 select-none font-serif text-4xl text-muted-foreground/35 leading-none"
      >
        &ldquo;
      </span>
      <blockquote
        className="line-clamp-6 text-pretty break-words font-medium italic leading-relaxed"
        dir="auto"
      >
        {markdownToPlainText(card.content)}
      </blockquote>
    </figure>
  );
}

/** Up to 12 swatches; hovering one widens it and shows its hex. */
function PaletteCardBody({ colors }: { colors: Array<{ hex: string }> }) {
  return (
    <div className={cn(CARD_SURFACE, "flex h-20 overflow-hidden")}>
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

/** A card of no known type, or a palette with no colors yet. */
function PlainCardBody({ card, textInsets }: TextBodyProps) {
  return (
    <div className={cn(CARD_SURFACE, "p-4", textInsets)}>
      <p className="line-clamp-4 break-words font-medium" dir="auto">
        {markdownToPlainText(card.content) || card.fileMetadata?.fileName}
      </p>
    </div>
  );
}
