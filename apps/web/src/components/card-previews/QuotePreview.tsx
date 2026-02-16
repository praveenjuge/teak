import type { Doc } from "@teak/convex/_generated/dataModel";
import { Textarea } from "@teak/ui/components/ui/textarea";

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
    <div className="relative h-full">
      {/* Large Opening Quote */}
      <div className="pointer-events-none absolute top-0 left-2 select-none font-serif text-6xl text-muted-foreground leading-none">
        &ldquo;
      </div>

      {/* Editable Quote Content */}
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

      {/* Large Closing Quote */}
      <div className="pointer-events-none absolute top-0 right-0 select-none font-serif text-6xl text-muted-foreground leading-none">
        &rdquo;
      </div>
    </div>
  );
}
