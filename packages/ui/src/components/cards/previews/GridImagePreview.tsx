import { ResilientMediaImage } from "./ResilientMediaImage";

interface GridImagePreviewProps {
  altText?: string;
  cardId?: string;
  compactUrl?: string;
  height?: number;
  imageUrl?: string;
  isPriority?: boolean;
  placeholderColor?: string;
  storageKey?: string;
  width?: number;
}

export function GridImagePreview({
  imageUrl,
  compactUrl,
  altText,
  cardId,
  width,
  height,
  isPriority = false,
  placeholderColor,
  storageKey,
}: GridImagePreviewProps) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-2xl border bg-card"
      style={{
        aspectRatio: width && height ? width / height : 4 / 3,
        backgroundColor: placeholderColor,
      }}
    >
      {imageUrl ? (
        <ResilientMediaImage
          alt={altText ?? "Image"}
          cardId={cardId}
          className="h-full w-full object-cover"
          decoding="async"
          fetchPriority={isPriority ? "high" : undefined}
          height={height ?? 512}
          loading={isPriority ? "eager" : "lazy"}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 256px"
          src={imageUrl}
          srcSet={
            compactUrl && compactUrl !== imageUrl
              ? `${compactUrl} 256w, ${imageUrl} 512w`
              : undefined
          }
          storageKey={storageKey}
          width={width ?? 512}
        />
      ) : (
        <div aria-hidden className="h-full w-full bg-muted" />
      )}
    </div>
  );
}
