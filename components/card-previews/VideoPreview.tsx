import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { type Doc } from "../../convex/_generated/dataModel";

interface VideoPreviewProps {
  card: Doc<"cards">;
}

export function VideoPreview({ card }: VideoPreviewProps) {
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId } : "skip"
  );
  
  if (!fileUrl) return null;
  
  return (
    <video controls className="w-full bg-black max-h-[70vh]" preload="metadata">
      <source src={fileUrl} type={card.metadata?.mimeType} />
      Your browser does not support the video tag.
    </video>
  );
}