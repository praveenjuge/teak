import { useMemo } from "react";
import { Image } from "antd";
import { type Doc } from "@teak/convex/_generated/dataModel";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

interface LinkPreviewProps {
  card: Doc<"cards"> & { screenshotUrl?: string };
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
  const linkImage = linkPreview?.imageUrl;
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
        className="flex border rounded w-full hover:bg-accent overflow-hidden items-center"
      >
        {linkImage && (
          <Image
            src={linkImage}
            alt="Open Graph preview"
            className="w-full max-h-26 object-contain"
            preview={false}
            placeholder
          />
        )}

        {showScreenshot && screenshotUrl && !linkImage && (
          <Image
            src={screenshotUrl}
            alt="Rendered webpage screenshot"
            className="w-full max-h-26 object-contain"
            preview={false}
            placeholder
          />
        )}

        <div className="min-w-0 shrink-0 flex-1 space-y-1 p-4">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2">
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
              <h2 className="font-semibold text-base leading-tight line-clamp-1 truncate">
                {linkTitle}
              </h2>
            </div>
            <ArrowUpRight className="size-4 text-muted-foreground" />
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
