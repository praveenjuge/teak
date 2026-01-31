import { Button } from "@/components/ui/button";
import {
  AudioPreview,
  DocumentPreview,
  ImagePreview,
  LinkPreview,
  PalettePreview,
  QuotePreview,
  TextPreview,
  VideoPreview,
} from "../card-previews";
import type { CardModalCard, GetCurrentValue } from "./types";

interface CardModalPreviewProps {
  card: CardModalCard;
  hasUnsavedChanges: boolean;
  isSaved: boolean;
  saveChanges: () => Promise<void>;
  updateContent: (value: string) => void;
  getCurrentValue: GetCurrentValue;
}

const renderPreviewByType = (
  card: CardModalCard,
  updateContent: (value: string) => void,
  getCurrentValue: GetCurrentValue
) => {
  switch (card.type) {
    case "text":
      return (
        <TextPreview
          card={card}
          getCurrentValue={getCurrentValue}
          onContentChange={updateContent}
        />
      );
    case "quote":
      return (
        <QuotePreview
          card={card}
          getCurrentValue={getCurrentValue}
          onContentChange={updateContent}
        />
      );
    case "link":
      return <LinkPreview card={card} showScreenshot />;
    case "image":
      return <ImagePreview card={card} />;
    case "video":
      return <VideoPreview card={card} />;
    case "audio":
      return <AudioPreview card={card} />;
    case "document":
      return <DocumentPreview card={card} />;
    case "palette":
      return <PalettePreview card={card} />;
    default:
      return <div>{card.content}</div>;
  }
};

export function CardModalPreview({
  card,
  hasUnsavedChanges,
  isSaved,
  saveChanges,
  updateContent,
  getCurrentValue,
}: CardModalPreviewProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-2 md:border-r">
      <div className="flex-1 overflow-y-auto p-4">
        {renderPreviewByType(card, updateContent, getCurrentValue)}
      </div>
      <div className="pointer-events-none absolute right-4 bottom-4 flex flex-col items-end gap-1">
        {hasUnsavedChanges && (
          <Button
            className="pointer-events-auto px-4"
            onClick={() => {
              void saveChanges();
            }}
            size="sm"
          >
            Save changes
          </Button>
        )}
        {!hasUnsavedChanges && isSaved && (
          <span className="rounded-md bg-background/80 px-2 py-1 text-muted-foreground text-xs shadow-sm">
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
