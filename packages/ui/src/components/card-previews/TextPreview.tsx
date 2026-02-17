import type { Doc } from "@teak/convex/_generated/dataModel";
import { Textarea } from "@teak/ui/components/ui/textarea";
import type { GetCurrentValue } from "../card-modal/types";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface TextPreviewProps {
  card: CardWithUrls;
  getCurrentValue?: GetCurrentValue;
  onContentChange: (content: string) => void;
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
      className="h-full resize-none rounded-none border-0 bg-transparent p-0 text-base leading-relaxed shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
      onChange={(e) => {
        const newContent = e.target.value;
        onContentChange(newContent);
      }}
      placeholder="Enter your text..."
      value={currentContent || ""}
    />
  );
}
