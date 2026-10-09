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
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="relative w-fit max-w-2xl">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 -left-4 select-none font-serif text-6xl text-muted-foreground/20 leading-none"
        >
          &ldquo;
        </span>

        <Textarea
          className="min-h-0 w-auto min-w-48 max-w-full resize-none rounded-none border-0 bg-transparent p-0 text-center font-medium text-xl italic leading-relaxed shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-2xl md:leading-relaxed dark:bg-transparent"
          onChange={(e) => {
            const newContent = e.target.value;
            onContentChange(newContent);
          }}
          placeholder="Enter your quote..."
          value={currentContent || ""}
        />

        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-4 -bottom-12 select-none font-serif text-6xl text-muted-foreground/20 leading-none"
        >
          &rdquo;
        </span>
      </div>
    </div>
  );
}
