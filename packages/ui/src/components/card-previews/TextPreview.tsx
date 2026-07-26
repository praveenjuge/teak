import type { Doc } from "@teak/convex/_generated/dataModel";
import { MarkdownTextEditor } from "@teak/ui/text-editor";
import { toast } from "sonner";
import type { GetCurrentValue } from "../card-modal/types";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface TextPreviewProps {
  card: CardWithUrls;
  getCurrentValue?: GetCurrentValue;
  onContentChange: (content: string) => void;
  onSaveShortcut?: () => void;
}

export function TextPreview({
  card,
  onContentChange,
  getCurrentValue,
  onSaveShortcut,
}: TextPreviewProps) {
  const currentContent = getCurrentValue
    ? getCurrentValue("content")
    : card.content;

  return (
    <MarkdownTextEditor
      ariaLabel="Markdown content"
      className="h-full"
      minHeight="55vh"
      onChange={onContentChange}
      onLimitExceeded={() =>
        toast.error("Notes can be up to 512 KiB of UTF-8 text")
      }
      onSaveShortcut={onSaveShortcut}
      placeholder="Write a note..."
      value={currentContent || ""}
      variant="modal"
    />
  );
}
