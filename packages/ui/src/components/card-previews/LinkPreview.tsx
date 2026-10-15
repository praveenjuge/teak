import type { Doc } from "@teak/convex/_generated/dataModel";
import {
  getSafeUrlHostname,
  sanitizeExternalUrl,
} from "@teak/convex/shared/utils/safeUrl";
import { ArrowUpRight, ImagePlus } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatLinkByline } from "../../lib/linkByline";
import { firstFile } from "../../lib/linkThumbnail";
import { resolveLinkTitle } from "../../lib/linkTitle";
import { cn } from "../../lib/utils";
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
  hasThumbnailOverride?: true;
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

/** Lets the preview take a dropped image as the link's new image. */
export interface LinkPreviewThumbnail {
  onFile: (file: File) => void;
  /** The image being uploaded, shown with a shimmer until it is applied. */
  uploadingPreviewUrl?: string;
}

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");

/**
 * A drop target for a new image, outlined while a file is dragged over it.
 * Drop-only: the details panel's Replace image button is the keyboard path.
 */
function ThumbnailDropZone({
  children,
  className,
  onFile,
}: {
  children: ReactNode;
  className?: string;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;

  useEffect(() => {
    const zone = ref.current;
    if (!zone) {
      return;
    }
    const accept = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return false;
      }
      // Keep the drop from the browser and from the library's drop-to-save.
      event.preventDefault();
      event.stopPropagation();
      return true;
    };
    const handleDragEnter = (event: DragEvent) => {
      if (accept(event)) {
        setIsOver(true);
      }
    };
    const handleDragOver = (event: DragEvent) => {
      if (accept(event) && event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    };
    const handleDragLeave = (event: DragEvent) => {
      if (!zone.contains(event.relatedTarget as Node | null)) {
        setIsOver(false);
      }
    };
    const handleDrop = (event: DragEvent) => {
      if (!accept(event)) {
        return;
      }
      setIsOver(false);
      const file = firstFile(event.dataTransfer?.files);
      if (file) {
        onFileRef.current(file);
      }
    };
    zone.addEventListener("dragenter", handleDragEnter);
    zone.addEventListener("dragover", handleDragOver);
    zone.addEventListener("dragleave", handleDragLeave);
    zone.addEventListener("drop", handleDrop);
    return () => {
      zone.removeEventListener("dragenter", handleDragEnter);
      zone.removeEventListener("dragover", handleDragOver);
      zone.removeEventListener("dragleave", handleDragLeave);
      zone.removeEventListener("drop", handleDrop);
    };
  }, []);

  return (
    <div
      className={cn(
        "relative rounded-2xl outline-2 outline-transparent outline-offset-4 transition-[outline-color]",
        isOver && "outline-dashed outline-primary",
        className
      )}
      data-drop-target={isOver ? "active" : undefined}
      ref={ref}
    >
      {children}
    </div>
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
  /** Set where the link's image can be replaced (the card dialog). */
  thumbnail?: LinkPreviewThumbnail;
}

export function LinkPreview({
  card,
  showScreenshot = false,
  LinkComponent,
  thumbnail,
}: LinkPreviewProps) {
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;

  const linkTitle = resolveLinkTitle({
    metadataTitle: card.metadataTitle,
    metadataTitleEdited: card.metadataTitleEdited,
    previewTitle: linkPreview?.title,
    url: card.url,
  });
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
  const byline = formatLinkByline({
    author: linkPreview?.author,
    hostname,
    publishedAt: linkPreview?.publishedAt,
    publisher: linkPreview?.publisher,
  });
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

  const imageClassName =
    "h-auto max-h-[30vh] w-auto max-w-full self-start rounded-2xl border bg-muted object-cover object-top md:max-h-[50vh]";
  const uploadingPreviewUrl = thumbnail?.uploadingPreviewUrl;
  let image: ReactNode = null;
  if (uploadingPreviewUrl) {
    image = (
      <span
        aria-busy="true"
        className="relative block self-start overflow-hidden rounded-2xl"
      >
        {/* biome-ignore lint/correctness/useImageSize: a local file of unknown size */}
        <img
          alt="Uploading the new link preview"
          className={imageClassName}
          src={uploadingPreviewUrl}
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-pulse bg-background/50"
        />
      </span>
    );
  } else if (previewImage) {
    image = (
      <ResilientMediaImage
        alt={card.hasThumbnailOverride ? "Link image" : previewImage.alt}
        cardId={card._id}
        className={imageClassName}
        height={630}
        key={previewImage.url}
        onPermanentError={() =>
          setFailedImageUrls((urls) => [...urls, previewImage.url])
        }
        src={previewImage.url}
        storageKey={
          card.hasThumbnailOverride
            ? card.thumbnailOverride?.storageKey
            : previewImage.storageKey
        }
        width={1200}
      />
    );
  }

  // With no image, the dialog offers a quiet place to drop one, outside the
  // link so a click never opens the site.
  const emptyDropArea =
    thumbnail && !image ? (
      <ThumbnailDropZone onFile={thumbnail.onFile}>
        <div className="flex h-32 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed text-muted-foreground text-sm">
          <ImagePlus aria-hidden="true" className="size-5" />
          Add an image
        </div>
      </ThumbnailDropZone>
    ) : null;

  const linkContent = (
    <>
      <div className="flex flex-col gap-4">
        {image &&
          (thumbnail ? (
            <ThumbnailDropZone className="self-start" onFile={thumbnail.onFile}>
              {image}
            </ThumbnailDropZone>
          ) : (
            image
          ))}

        <div className="space-y-1.5 px-1">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 text-balance break-words font-semibold text-lg leading-snug underline-offset-4 group-hover:underline">
              {linkTitle}
            </h2>
            <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
          </div>

          {(hostname || byline) && (
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm">
              {hostname && faviconUrl && (
                <span className="size-4 shrink-0">
                  <FaviconImage
                    fallbackUrl={googleFaviconUrl}
                    faviconUrl={faviconUrl}
                  />
                </span>
              )}
              {hostname && (
                <span className="max-w-[60%] shrink-0 truncate">
                  {hostname}
                </span>
              )}
              {hostname && byline && (
                <span aria-hidden="true" className="shrink-0">
                  ·
                </span>
              )}
              {byline && (
                <span className="min-w-0 truncate" title={byline}>
                  {byline}
                </span>
              )}
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
        {emptyDropArea}
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
      {emptyDropArea}
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
