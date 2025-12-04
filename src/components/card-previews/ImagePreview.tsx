import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import { type Doc } from "@teak/convex/_generated/dataModel";
import { Image } from "antd";

interface ImagePreviewProps {
  card: Doc<"cards">;
}

export function ImagePreview({ card }: ImagePreviewProps) {
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId } : "skip"
  );

  if (!fileUrl) return null;

  return (
    <div className="w-full h-full flex items-center justify-center">
      <Image
        src={fileUrl}
        alt={card.content}
        className="max-h-[75vh] max-w-full"
        preview={false}
        placeholder
      />
    </div>
  );
}
