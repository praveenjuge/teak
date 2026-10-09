import type { Doc } from "@teak/convex/_generated/dataModel";
import {
  getSafeUrlHostname,
  sanitizeExternalUrl,
} from "@teak/convex/shared/utils/safeUrl";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ResilientMediaImage } from "../cards/previews/ResilientMediaImage";

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
  const [failedImageUrls, setFailedImageUrls] = useState<string[]>([]);
  const linkMedia = card.linkPreviewMedia ?? [];

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

  const hostname = getSafeUrlHostname(card.url)?.replace(/^www\./, "");
  const screenshotUrl = showScreenshot ? card.screenshotUrl : undefined;
  // Fall back to the screenshot, then to no image, when a stored preview
  // fails to load, so the modal never shows a broken image.
  const previewImages = [
    {
      alt: "Open Graph preview",
      storageKey: card.metadata?.linkPreview?.imageStorageKey,
      url: linkImage,
    },
    {
      alt: "Rendered webpage screenshot",
      storageKey: card.metadata?.linkPreview?.screenshotStorageKey,
      url: screenshotUrl,
    },
  ];
  const previewImage = previewImages.find(
    (image): image is typeof image & { url: string } =>
      Boolean(image.url) && !failedImageUrls.includes(image.url ?? "")
  );

  const linkContent = (
    <>
      <div className="flex flex-col gap-4">
        {previewImage && (
          <ResilientMediaImage
            alt={previewImage.alt}
            cardId={card._id}
            className="h-auto max-h-[30vh] w-auto max-w-full self-start rounded-2xl border bg-muted object-cover object-top md:max-h-[50vh]"
            height={630}
            key={previewImage.url}
            onPermanentError={() =>
              setFailedImageUrls((urls) => [...urls, previewImage.url])
            }
            src={previewImage.url}
            storageKey={previewImage.storageKey}
            width={1200}
          />
        )}

        <div className="space-y-1.5 px-1">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 text-balance break-words font-semibold text-lg leading-snug underline-offset-4 group-hover:underline">
              {linkTitle}
            </h2>
            <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
          </div>

          {hostname && (
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm">
              {faviconUrl && (
                <span className="size-4 shrink-0">
                  <FaviconImage
                    fallbackUrl={googleFaviconUrl}
                    faviconUrl={faviconUrl}
                  />
                </span>
              )}
              <span className="truncate">{hostname}</span>
            </div>
          )}

          {linkDescription && (
            <p className="line-clamp-3 pt-1 text-muted-foreground text-sm leading-relaxed">
              {linkDescription}
            </p>
          )}
        </div>
      </div>

      {categoryMetadata?.facts?.length ? (
        <dl className="grid grid-cols-2 gap-2 pt-4 sm:grid-cols-4">
          {categoryMetadata.facts.map((fact) => (
            <div
              className="flex flex-col gap-0.5 rounded-xl border bg-card px-3 py-2"
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
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6">
        {safeUrl ? (
          <LinkComponent
            className="group block"
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
                  key={`${media.type}-${media.url}`}
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
                  key={`${media.type}-${media.url}`}
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
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-6">
      {safeUrl ? (
        <a
          className="group block"
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
                key={`${media.type}-${media.url}`}
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
                key={`${media.type}-${media.url}`}
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
