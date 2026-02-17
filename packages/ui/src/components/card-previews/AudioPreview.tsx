import type { Doc } from "@teak/convex/_generated/dataModel";
import { Sparkles } from "lucide-react";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface AudioPreviewProps {
  card: CardWithUrls;
}

export function AudioPreview({ card }: AudioPreviewProps) {
  const fileUrl = card.fileUrl;

  return (
    <div className="space-y-4 p-2">
      {fileUrl && (
        <audio className="w-full" controls>
          <source src={fileUrl} type={card.fileMetadata?.mimeType} />
          <track kind="captions" />
          Your browser does not support the audio element.
        </audio>
      )}

      {card.aiTranscript && (
        <div className="rounded-lg border bg-background">
          <div className="flex w-full items-center gap-2 px-3 pt-3 text-left">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-medium">Transcript</span>
          </div>

          <div className="max-h-64 overflow-y-auto p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {card.aiTranscript}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
