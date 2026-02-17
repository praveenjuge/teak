import type { Doc } from "@teak/convex/_generated/dataModel";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewImageUrl?: string;
};

function FaviconImage({
  faviconUrl,
  fallbackUrl,
}: {
  faviconUrl: string;
  fallbackUrl?: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [hasError, setHasError] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    const handleError = () => {
      if (fallbackUrl && !usedFallback) {
        setUsedFallback(true);
        img.src = fallbackUrl;
      } else {
        setHasError(true);
      }
    };

    img.addEventListener("error", handleError);
    return () => img.removeEventListener("error", handleError);
  }, [fallbackUrl, usedFallback]);

  if (hasError) return null;

  return (
    // biome-ignore lint/correctness/useImageSize: <>
    <img alt="" className="size-4" ref={imgRef} src={faviconUrl} />
  );
}

interface LinkPreviewProps {
  card: CardWithUrls;
  LinkComponent?: React.ComponentType<{
    href: string;
    className?: string;
    target?: string;
    rel?: string;
    children: React.ReactNode;
  }>;
  showScreenshot?: boolean;
}

export function LinkPreview({
  card,
  showScreenshot = false,
  LinkComponent,
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

  const linkContent = (
    <>
      <div className="flex w-full flex-col overflow-hidden rounded border hover:bg-accent sm:flex-row">
        {linkImage && (
          <img
            alt="Open Graph preview"
            className="h-auto max-h-60 w-full object-contain sm:h-full sm:max-h-40 sm:w-60"
            height={240}
            src={linkImage}
            width={240}
          />
        )}

        {showScreenshot && screenshotUrl && !linkImage && (
          <img
            alt="Rendered webpage screenshot"
            className="h-auto max-h-60 w-full object-contain sm:h-full sm:max-h-40 sm:w-60"
            height={240}
            src={screenshotUrl}
            width={240}
          />
        )}

        <div className="min-w-0 flex-1 shrink-0 space-y-1 p-4">
          <div className="flex w-full min-w-0 items-center gap-2">
            {faviconUrl && (
              <div className="mt-0.5 size-4 shrink-0">
                <FaviconImage
                  fallbackUrl={
                    card.url
                      ? `https://www.google.com/s2/favicons?domain=${card.url}`
                      : undefined
                  }
                  faviconUrl={faviconUrl}
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
      </div>

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
    </>
  );

  if (LinkComponent) {
    return (
      <div className="flex flex-col gap-6">
        <LinkComponent
          className="block"
          href={card.url || "#"}
          rel="noopener noreferrer"
          target="_blank"
        >
          {linkContent}
        </LinkComponent>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <a
        className="block"
        href={card.url || "#"}
        rel="noopener noreferrer"
        target="_blank"
      >
        {linkContent}
      </a>
    </div>
  );
}
