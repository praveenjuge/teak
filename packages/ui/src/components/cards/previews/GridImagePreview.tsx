import { Image } from "antd";

interface GridImagePreviewProps {
  altText?: string;
  height?: number;
  imageUrl?: string;
  isPriority?: boolean;
  width?: number;
}

export function GridImagePreview({
  imageUrl,
  altText,
  width,
  height,
  isPriority = false,
}: GridImagePreviewProps) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-xl border bg-card"
      style={{ aspectRatio: width && height ? width / height : 4 / 3 }}
    >
      {imageUrl ? (
        <Image
          alt={altText ?? "Image"}
          className="h-full w-full object-cover"
          decoding="async"
          fetchPriority={isPriority ? "high" : undefined}
          loading={isPriority ? "eager" : "lazy"}
          preview={false}
          rootClassName="h-full w-full"
          src={imageUrl}
          style={{ objectFit: "cover" }}
        />
      ) : (
        <div aria-hidden className="h-full w-full bg-muted" />
      )}
    </div>
  );
}
