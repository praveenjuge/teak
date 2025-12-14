import { type Doc } from "@teak/convex/_generated/dataModel";
import { Sparkles } from "lucide-react";

interface AudioPreviewProps {
  card: Doc<"cards"> & { fileUrl?: string };
}

export function AudioPreview({ card }: AudioPreviewProps) {
  const fileUrl = card.fileUrl;

  return (
    <div className="p-2 space-y-4">
      {fileUrl && (
        <audio controls className="w-full">
          <source src={fileUrl} type={card.fileMetadata?.mimeType} />
          Your browser does not support the audio element.
        </audio>
      )}

      {/* Transcript Section */}
      {card.aiTranscript && (
        <div className="border bg-background rounded-lg">
          <div className="w-full px-3 pt-3 flex items-center text-left gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-medium">Transcript</span>
          </div>

          <div className="p-3 max-h-64 overflow-y-auto">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {card.aiTranscript}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
