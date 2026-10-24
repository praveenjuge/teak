import type { Doc } from "@teak/convex/_generated/dataModel";
import {
  getSafeUrlHostname,
  sanitizeExternalUrl,
} from "@teak/convex/shared/utils/safeUrl";
import { useIntlLocale, useTranslations } from "@teak/i18n/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ImagePlus } from "vadivam-react";
import { US_ENGLISH_LOCALE } from "../../lib/englishTranslators";
import { formatLinkByline } from "../../lib/linkByline";
import { firstFile } from "../../lib/linkThumbnail";
import { resolveLinkTitle } from "../../lib/linkTitle";
import { linkNoteText } from "../../lib/markdownToPlainText";
import { cn } from "../../lib/utils";
import { ResilientMediaImage } from "../cards/previews/ResilientMediaImage";
import { SiteFavicon } from "../cards/SiteFavicon";

function formatFactValue(value: string, locale: string | undefined) {
  const trimmed = value.trim();
  if (/^\d{5,}$/.test(trimmed)) {
    return Number(trimmed).toLocaleString(locale);
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

export interface LinkPreviewThumbnail {
  onFile: (file: File) => void;
  uploadingPreviewUrl?: string;
}

const hasFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");

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
      event.preventDefault();
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
      data-no-drop=""
      ref={ref}
    >
      {children}
    </div>
  );
}

/** A link's note shows in full here, unlike the grid's three lines. */
const NOTE_MAX_LENGTH = 4000;

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
  thumbnail?: LinkPreviewThumbnail;
}

export function LinkPreview({
  card,
  showScreenshot = false,
  LinkComponent,
  thumbnail,
}: LinkPreviewProps) {
  const t = useTranslations("cardPreviews.link");
  const tLinkTitle = useTranslations("lib.linkTitle");
  const tByline = useTranslations("lib.linkByline");
  const locale = useIntlLocale();
  const bylineLocale = useIntlLocale(US_ENGLISH_LOCALE);
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;

  const linkTitle = resolveLinkTitle(
    {
      metadataTitle: card.metadataTitle,
      metadataTitleEdited: card.metadataTitleEdited,
      previewTitle: linkPreview?.title,
      url: card.url,
    },
    tLinkTitle
  );
  const linkDescription = linkPreview?.description || card.metadataDescription;
  const note = linkNoteText(card.content, {
    maxLength: NOTE_MAX_LENGTH,
    title: linkTitle,
  });
  const linkImage = card.linkPreviewImageUrl;
  const [failedImageUrls, setFailedImageUrls] = useState<string[]>([]);
  const linkMedia = card.linkPreviewMedia ?? [];

  const categoryMetadata = card.metadata?.linkCategory;

  const safeUrl = useMemo(() => sanitizeExternalUrl(card.url), [card.url]);

  const hostname = getSafeUrlHostname(card.url)?.replace(/^www\./, "");
  const byline = formatLinkByline(
    {
      author: linkPreview?.author,
      hostname,
      publishedAt: linkPreview?.publishedAt,
      publisher: linkPreview?.publisher,
    },
    Date.now(),
    tByline,
    bylineLocale
  );
  const screenshotUrl = showScreenshot ? card.screenshotUrl : undefined;
  const previewImages = [
    {
      alt: t("openGraphAlt"),
      storageKey: card.metadata?.linkPreview?.imageStorageKey,
      url: linkImage,
    },
    {
      alt: t("screenshotAlt"),
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
          alt={t("uploadingAlt")}
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
        alt={card.hasThumbnailOverride ? t("imageAlt") : previewImage.alt}
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

  const emptyDropArea =
    thumbnail && !image ? (
      <ThumbnailDropZone onFile={thumbnail.onFile}>
        <div className="flex h-32 flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed text-muted-foreground text-sm">
          <ImagePlus aria-hidden="true" className="size-5" />
          {t("addImage")}
        </div>
      </ThumbnailDropZone>
    ) : null;

  const imageSlot =
    image && thumbnail ? (
      <ThumbnailDropZone className="self-start" onFile={thumbnail.onFile}>
        {image}
      </ThumbnailDropZone>
    ) : (
      image
    );

  const noteText = note ? (
    <p className="break-words px-1 text-sm leading-relaxed" dir="auto">
      {note}
    </p>
  ) : null;

  const linkContent = (
    <>
      <div className="flex flex-col gap-4">
        {imageSlot}

        <div className="space-y-1.5 px-1">
          <div className="flex items-start gap-2">
            <h2 className="min-w-0 flex-1 text-balance break-words font-semibold text-lg leading-snug underline-offset-4 group-hover:underline">
              {linkTitle}
            </h2>
            <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
          </div>

          {hostname || byline ? (
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm">
              {hostname && (
                <SiteFavicon className="size-4" hostname={hostname} />
              )}
              {hostname && (
                <span className="max-w-[60%] shrink-0 truncate">
                  {hostname}
                </span>
              )}
              {hostname && byline ? (
                <span aria-hidden="true" className="shrink-0">
                  ·
                </span>
              ) : null}
              {byline && (
                <span className="min-w-0 truncate" title={byline}>
                  {byline}
                </span>
              )}
            </div>
          ) : null}

          {linkDescription ? (
            <p className="line-clamp-3 pt-1 text-muted-foreground text-sm leading-relaxed">
              {linkDescription}
            </p>
          ) : null}
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
                {formatFactValue(fact.value, locale)}
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
        {noteText}
        {linkMedia.length ? (
          <div className="flex flex-col gap-4">
            {linkMedia.map((media, index) =>
              media.type === "video" ? (
                <video
                  aria-label={t("attachedVideo", { number: index + 1 })}
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
                  alt={t("attachedMedia", { number: index + 1 })}
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
      {noteText}
      {linkMedia.length ? (
        <div className="flex flex-col gap-4">
          {linkMedia.map((media, index) =>
            media.type === "video" ? (
              <video
                aria-label={t("attachedVideo", { number: index + 1 })}
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
                alt={t("attachedMedia", { number: index + 1 })}
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
