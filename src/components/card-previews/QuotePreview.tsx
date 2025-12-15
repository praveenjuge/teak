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
    <div className="h-full relative">
      {/* Large Opening Quote */}
      <div className="absolute select-none pointer-events-none top-0 left-2 text-6xl text-muted-foreground leading-none font-serif">
        &ldquo;
      </div>

      {/* Editable Quote Content */}
      <Textarea
        value={currentContent || ""}
        onChange={(e) => {
          const newContent = e.target.value;
          onContentChange(newContent);
        }}
        placeholder="Enter your quote..."
        className="text-xl md:text-2xl font-medium leading-relaxed italic resize-none border-0 shadow-none focus-visible:border-0 focus-visible:ring-0 bg-transparent dark:bg-transparent h-auto font-serif p-10 text-center"
        style={{
          lineHeight: "1.6",
        }}
      />

      {/* Large Closing Quote */}
      <div className="absolute select-none pointer-events-none top-0 right-0 text-6xl text-muted-foreground leading-none font-serif">
        &rdquo;
      </div>
    </div>
  );
}
