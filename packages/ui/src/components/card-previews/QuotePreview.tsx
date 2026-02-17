import type { Doc } from "@teak/convex/_generated/dataModel";
import { Textarea } from "@teak/ui/components/ui/textarea";
import type { GetCurrentValue } from "../card-modal/types";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface QuotePreviewProps {
  card: CardWithUrls;
  getCurrentValue?: GetCurrentValue;
  onContentChange: (content: string) => void;
}

export function QuotePreview({
  card,
  onContentChange,
  getCurrentValue,
}: QuotePreviewProps) {
  const currentContent = getCurrentValue
    ? getCurrentValue("content")
    : card.content;

  return (
    <div className="relative h-full">
      <div className="pointer-events-none absolute top-0 left-2 select-none font-serif text-6xl text-muted-foreground leading-none">
        &ldquo;
      </div>

      <Textarea
        className="h-auto resize-none border-0 bg-transparent p-10 text-center font-medium font-serif text-xl italic leading-relaxed shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-2xl dark:bg-transparent"
        onChange={(e) => {
          const newContent = e.target.value;
          onContentChange(newContent);
        }}
        placeholder="Enter your quote..."
        style={{
          lineHeight: "1.6",
        }}
        value={currentContent || ""}
      />

      <div className="pointer-events-none absolute top-0 right-0 select-none font-serif text-6xl text-muted-foreground leading-none">
        &rdquo;
      </div>
    </div>
  );
}
