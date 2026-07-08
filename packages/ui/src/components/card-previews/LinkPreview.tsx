import type { Doc } from "@teak/convex/_generated/dataModel";
import {
  getSafeUrlHostname,
  sanitizeExternalUrl,
} from "@teak/convex/shared/utils/safeUrl";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

// Format long whole numbers (e.g. review counts) with thousands separators for
// readability. Values with 5+ digits are formatted so years like "2024" and
// short counts stay untouched.
function formatFactValue(value: string) {
  const trimmed = value.trim();
  if (/^\d{5,}$/.test(trimmed)) {
    return Number(trimmed).toLocaleString();
  }
  return value;
}

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewMedia?: Array<{
    contentType?: string;
    height?: number;
    posterContentType?: string;
    posterHeight?: number;
    posterUrl?: string;
    posterWidth?: number;
    type: "image" | "video";
    url: string;
    width?: number;
  }>;
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
  const usedFallbackRef = useRef(false);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) {
      return;
    }

    const handleError = () => {
      if (fallbackUrl && !usedFallbackRef.current) {
        usedFallbackRef.current = true;
        img.src = fallbackUrl;
      } else {
        setHasError(true);
      }
    };

    img.addEventListener("error", handleError);
    return () => img.removeEventListener("error", handleError);
  }, [fallbackUrl]);

  if (hasError) {
    return null;
  }

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
  const linkImage = card.linkPreviewImageUrl;
  const linkMedia = card.linkPreviewMedia ?? [];

  const screenshotUrl = showScreenshot ? card.screenshotUrl : undefined;

  // Only expose the hostname (never the full path/query) to the third-party
  // favicon service, so private saved URLs don't leak IDs or tokens to Google.
  const googleFaviconUrl = useMemo(() => {
    const hostname = getSafeUrlHostname(card.url);
    return hostname
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}`
      : undefined;
  }, [card.url]);

  const faviconUrl = googleFaviconUrl;

  const categoryMetadata = card.metadata?.linkCategory;

  const safeUrl = useMemo(() => sanitizeExternalUrl(card.url), [card.url]);

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
                  fallbackUrl={googleFaviconUrl}
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
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 pt-4">
          {categoryMetadata.facts.map((fact) => (
            <div
              className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2"
              key={`${fact.label}-${fact.value}`}
            >
              <dt className="truncate font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {fact.label}
              </dt>
              <dd className="break-words font-semibold text-foreground text-sm">
                {formatFactValue(fact.value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </>
  );

  if (LinkComponent) {
    return (
      <div className="flex flex-col gap-6">
        {safeUrl ? (
          <LinkComponent
            className="block"
            href={safeUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {linkContent}
          </LinkComponent>
        ) : (
          <div className="block">{linkContent}</div>
        )}
        {linkMedia.length ? (
          <div className="flex flex-col gap-4">
            {linkMedia.map((media, index) =>
              media.type === "video" ? (
                <video
                  aria-label={`Attached video ${index + 1}`}
                  className="w-full rounded-xl border bg-black"
                  controls
                  key={`${media.type}-${media.url}-${index}`}
                  playsInline
                  poster={media.posterUrl}
                  preload="metadata"
                >
                  <source src={media.url} type={media.contentType} />
                  <track kind="captions" />
                </video>
              ) : (
                <img
                  alt={`Attached post media ${index + 1}`}
                  className="w-full rounded-xl border object-contain"
                  height={media.height}
                  key={`${media.type}-${media.url}-${index}`}
                  src={media.url}
                  width={media.width}
                />
              )
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {safeUrl ? (
        <a
          className="block"
          href={safeUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          {linkContent}
        </a>
      ) : (
        <div className="block">{linkContent}</div>
      )}
      {linkMedia.length ? (
        <div className="flex flex-col gap-4">
          {linkMedia.map((media, index) =>
            media.type === "video" ? (
              <video
                aria-label={`Attached video ${index + 1}`}
                className="w-full rounded-xl border bg-black"
                controls
                key={`${media.type}-${media.url}-${index}`}
                playsInline
                poster={media.posterUrl}
                preload="metadata"
              >
                <source src={media.url} type={media.contentType} />
                <track kind="captions" />
              </video>
            ) : (
              <img
                alt={`Attached post media ${index + 1}`}
                className="w-full rounded-xl border object-contain"
                height={media.height}
                key={`${media.type}-${media.url}-${index}`}
                src={media.url}
                width={media.width}
              />
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
