import { Textarea } from "../ui/textarea";
import { type Doc } from "@teak/convex/_generated/dataModel";

interface QuotePreviewProps {
  card: Doc<"cards">;
  onContentChange: (content: string) => void;
  getCurrentValue?: (field: "content") => string | undefined;
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
    <div className="h-full flex flex-col justify-center items-center p-8 text-center relative">
      {/* Large Opening Quote */}
      <div className="absolute select-auto pointer-events-none top-4 left-4 text-6xl text-muted-foreground leading-none font-serif">
        &ldquo;
      </div>

      {/* Editable Quote Content */}
      <div className="max-w-3xl w-full">
        <Textarea
          value={currentContent || ""}
          onChange={(e) => {
            const newContent = e.target.value;
            onContentChange(newContent);
          }}
          placeholder="Enter your quote..."
          className="text-xl md:text-2xl font-medium leading-relaxed text-foreground italic text-center resize-none border-0 shadow-none focus-visible:border-0 focus-visible:ring-0 bg-transparent dark:bg-transparent min-h-[200px] text-balance h-auto font-serif"
          style={{
            lineHeight: "1.6",
          }}
        />
      </div>

      {/* Large Closing Quote */}
      <div className="absolute select-auto pointer-events-none bottom-0 right-4 text-6xl text-muted-foreground leading-none font-serif">
        &rdquo;
      </div>
    </div>
  );
}
