import { Image } from "antd";

interface GridImagePreviewProps {
  altText?: string;
  height?: number;
  imageUrl?: string;
  isPriority?: boolean;
  placeholderUrl?: string;
  width?: number;
}

export function GridImagePreview({
  imageUrl,
  altText,
  width,
  height,
  isPriority = false,
  placeholderUrl,
}: GridImagePreviewProps) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-xl border bg-card"
      style={{ aspectRatio: width && height ? width / height : 4 / 3 }}
    >
      {imageUrl ? (
        <>
          {placeholderUrl ? (
            <img
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-md"
              height={48}
              src={placeholderUrl}
              width={48}
            />
          ) : null}
          <Image
            alt={altText ?? "Image"}
            className="h-full w-full object-cover"
            decoding="async"
            fetchPriority={isPriority ? "high" : undefined}
            loading={isPriority ? "eager" : "lazy"}
            preview={false}
            rootClassName="relative h-full w-full"
            src={imageUrl}
            style={{ objectFit: "cover" }}
          />
        </>
      ) : (
        <div aria-hidden className="h-full w-full bg-muted" />
      )}
    </div>
  );
}
