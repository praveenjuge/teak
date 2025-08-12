import { type Doc } from "../../convex/_generated/dataModel";

interface LinkPreviewProps {
  card: Doc<"cards">;
}

export function LinkPreview({ card }: LinkPreviewProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://www.google.com/s2/favicons?domain=${card.url}`}
          alt=""
          className="w-5 h-5 mt-0.5 flex-shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-lg leading-tight line-clamp-2">
            {card.metadata?.linkTitle || card.url || "Link"}
          </h2>
          {card.url && (
            <p className="text-muted-foreground truncate">{card.url}</p>
          )}
        </div>
      </div>
      {card.metadata?.linkImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={card.metadata.linkImage}
          alt=""
          className="w-full max-h-[60vh] object-cover rounded"
        />
      )}
      {card.notes && (
        <p className="text-base text-muted-foreground whitespace-pre-wrap">
          {card.notes}
        </p>
      )}
    </div>
  );
}