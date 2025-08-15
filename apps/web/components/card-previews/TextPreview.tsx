import { Textarea } from "../ui/textarea";
import { type Doc } from "@teak/convex/_generated/dataModel";

interface TextPreviewProps {
  card: Doc<"cards">;
  onContentChange: (content: string) => void;
  getCurrentValue?: (field: "content") => string | undefined;
}

export function TextPreview({
  card,
  onContentChange,
  getCurrentValue,
}: TextPreviewProps) {
  const currentContent = getCurrentValue
    ? getCurrentValue("content")
    : card.content;

  return (
    <Textarea
      value={currentContent || ""}
      onChange={(e) => {
        const newContent = e.target.value;
        onContentChange(newContent);
      }}
      placeholder="Enter your text..."
      className="h-full resize-none text-base leading-relaxed border-0 shadow-none p-0 focus-visible:border-0 focus-visible:ring-0 rounded-none"
    />
  );
}
