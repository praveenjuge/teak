import type { Doc } from "@teak/convex/_generated/dataModel";
import { Image } from "antd";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

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
    if (linkFavicon) {
      return linkFavicon;
    }
    if (!card.url) {
      return undefined;
    }
    return `https://www.google.com/s2/favicons?domain=${card.url}`;
  }, [card.url, linkFavicon]);

  const categoryMetadata = card.metadata?.linkCategory;

  return (
    <div className="flex flex-col gap-6">
      <Link
        className="flex w-full flex-col overflow-hidden rounded border hover:bg-accent sm:flex-row"
        href={card.url || "#"}
        rel="noopener noreferrer"
        target="_blank"
      >
        {linkImage && (
          <Image
            alt="Open Graph preview"
            className="h-auto max-h-60 w-full object-contain sm:h-full sm:max-h-40 sm:w-60"
            placeholder
            preview={false}
            src={linkImage}
          />
        )}

        {showScreenshot && screenshotUrl && !linkImage && (
          <Image
            alt="Rendered webpage screenshot"
            className="h-auto max-h-60 w-full object-contain sm:h-full sm:max-h-40 sm:w-60"
            placeholder
            preview={false}
            src={screenshotUrl}
          />
        )}

        <div className="min-w-0 flex-1 shrink-0 space-y-1 p-4">
          <div className="flex w-full min-w-0 items-center gap-2">
            {faviconUrl && (
              <div className="mt-0.5 size-4 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
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
                  src={faviconUrl}
                />
              </div>
            )}
            <h2 className="min-w-0 flex-1 truncate font-semibold text-base leading-tight">
              {linkTitle}
            </h2>
            <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
          </div>

          {linkDescription && (
            <p className="mt-2 line-clamp-2 text-muted-foreground text-sm">
              {linkDescription}
            </p>
          )}
        </div>
      </Link>

      {categoryMetadata?.facts?.length ? (
        <div className="space-y-1 text-muted-foreground text-sm">
          {categoryMetadata.facts.map((fact) => (
            <div className="flex gap-2" key={`${fact.label}-${fact.value}`}>
              <span className="font-medium text-foreground">{fact.label}:</span>
              <span className="text-balance">{fact.value}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
