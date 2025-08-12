import { Textarea } from "../ui/textarea";
import { type Doc } from "../../convex/_generated/dataModel";

interface TextPreviewProps {
  card: Doc<"cards">;
  onContentChange: (content: string) => void;
}

export function TextPreview({ card, onContentChange }: TextPreviewProps) {
  return (
    <Textarea
      value={card.content || ""}
      onChange={(e) => {
        const newContent = e.target.value;
        onContentChange(newContent.trim());
      }}
      placeholder="Enter your text..."
      className="h-full resize-none text-base leading-relaxed"
    />
  );
}