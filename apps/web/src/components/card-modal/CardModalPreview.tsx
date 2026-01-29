import { Button } from "@/components/ui/button";
import {
  LinkPreview,
  ImagePreview,
  VideoPreview,
  AudioPreview,
  DocumentPreview,
  TextPreview,
  PalettePreview,
  QuotePreview,
} from "../card-previews";
import type { CardModalCard, GetCurrentValue } from "./types";

type CardModalPreviewProps = {
  card: CardModalCard;
  hasUnsavedChanges: boolean;
  isSaved: boolean;
  saveChanges: () => Promise<void>;
  updateContent: (value: string) => void;
  getCurrentValue: GetCurrentValue;
};

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
          onContentChange={updateContent}
          getCurrentValue={getCurrentValue}
        />
      );
    case "quote":
      return (
        <QuotePreview
          card={card}
          onContentChange={updateContent}
          getCurrentValue={getCurrentValue}
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
    <div className="flex-1 md:flex-2 md:border-r overflow-hidden flex flex-col min-h-0 relative">
      <div className="flex-1 p-4 overflow-y-auto">
        {renderPreviewByType(card, updateContent, getCurrentValue)}
      </div>
      <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col items-end gap-1">
        {hasUnsavedChanges && (
          <Button
            size="sm"
            className="px-4 pointer-events-auto"
            onClick={() => {
              void saveChanges();
            }}
          >
            Save changes
          </Button>
        )}
        {!hasUnsavedChanges && isSaved && (
          <span className="text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded-md shadow-sm">
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
