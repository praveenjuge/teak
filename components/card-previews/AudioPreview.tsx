import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { type Doc } from "../../convex/_generated/dataModel";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";

interface AudioPreviewProps {
  card: Doc<"cards">;
}

export function AudioPreview({ card }: AudioPreviewProps) {
  const [isTranscriptCollapsed, setIsTranscriptCollapsed] = useState(false);
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId } : "skip"
  );

  if (!fileUrl) return null;

  return (
    <div className="p-2 space-y-4">
      <audio controls className="w-full">
        <source src={fileUrl} type={card.metadata?.mimeType} />
        Your browser does not support the audio element.
      </audio>

      {/* Transcript Section */}
      {card.transcript && (
        <div className="border rounded-lg">
          <button
            onClick={() => setIsTranscriptCollapsed(!isTranscriptCollapsed)}
            className="w-full p-3 flex items-center justify-between text-left bg-gray-50 hover:bg-gray-100 rounded-t-lg transition-colors"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-blue-500" />
              <span className="font-medium">Transcript</span>
            </div>
            {isTranscriptCollapsed ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>

          {!isTranscriptCollapsed && (
            <div className="p-3 max-h-64 overflow-y-auto">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {card.transcript}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}