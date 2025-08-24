import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
import { type Doc } from "@teak/convex/_generated/dataModel";

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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fileUrl}
        alt={card.content}
        className="max-h-[70vh] max-w-full object-contain"
      />
    </div>
  );
}
