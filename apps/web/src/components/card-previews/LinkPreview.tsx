import { useMemo } from "react";
import { Image } from "antd";
import { type Doc } from "@teak/convex/_generated/dataModel";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

interface LinkPreviewProps {
  card: Doc<"cards"> & { screenshotUrl?: string; linkPreviewImageUrl?: string };
  showScreenshot?: boolean;
}

export function LinkPreview({
  card,
  showScreenshot = false,
}: LinkPreviewProps) {
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;

  const linkTitle =
    linkPreview?.title || card.metadataTitle || card.url || "Link";
  const linkDescription = linkPreview?.description || card.metadataDescription;
  const linkImage = card.linkPreviewImageUrl ?? linkPreview?.imageUrl;
  const linkFavicon = linkPreview?.faviconUrl;

  const screenshotUrl = showScreenshot ? card.screenshotUrl : undefined;

  const faviconUrl = useMemo(() => {
    if (linkFavicon) return linkFavicon;
    if (!card.url) return undefined;
    return `https://www.google.com/s2/favicons?domain=${card.url}`;
  }, [card.url, linkFavicon]);

  const categoryMetadata = card.metadata?.linkCategory;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={card.url || "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full flex-col overflow-hidden rounded border hover:bg-accent sm:flex-row"
      >
        {linkImage && (
          <Image
            src={linkImage}
            alt="Open Graph preview"
            className="h-auto w-full max-h-60 object-contain sm:h-full sm:max-h-40 sm:w-60"
            preview={false}
            placeholder
          />
        )}

        {showScreenshot && screenshotUrl && !linkImage && (
          <Image
            src={screenshotUrl}
            alt="Rendered webpage screenshot"
            className="h-auto w-full max-h-60 object-contain sm:h-full sm:max-h-40 sm:w-60"
            preview={false}
            placeholder
          />
        )}

        <div className="min-w-0 flex-1 shrink-0 space-y-1 p-4">
          <div className="flex w-full min-w-0 items-center gap-2">
            {faviconUrl && (
              <div className="size-4 mt-0.5 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={faviconUrl}
                  alt=""
                  className="size-4"
                  onError={(event) => {
                    const target = event.currentTarget;
                    if (card.url && !target.dataset.fallback) {
                      target.dataset.fallback = "true";
                      target.src = `https://www.google.com/s2/favicons?domain=${card.url}`;
                    } else {
                      target.style.display = "none";
                    }
                  }}
                />
              </div>
            )}
            <h2 className="min-w-0 flex-1 truncate font-semibold text-base leading-tight">
              {linkTitle}
            </h2>
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
          </div>

          {linkDescription && (
            <p className="text-muted-foreground text-sm line-clamp-2 mt-2">
              {linkDescription}
            </p>
          )}
        </div>
      </Link>

      {categoryMetadata?.facts?.length ? (
        <div className="space-y-1 text-sm text-muted-foreground">
          {categoryMetadata.facts.map((fact) => (
            <div key={`${fact.label}-${fact.value}`} className="flex gap-2">
              <span className="font-medium text-foreground">{fact.label}:</span>
              <span className="text-balance">{fact.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
