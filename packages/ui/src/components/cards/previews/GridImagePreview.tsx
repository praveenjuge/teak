import { Image } from "antd";

interface GridImagePreviewProps {
  altText?: string;
  height?: number;
  imageUrl?: string;
  /** Load the image eagerly for the first viewport row. */
  priority?: boolean;
  width?: number;
}

export function GridImagePreview({
  imageUrl,
  altText,
  priority = false,
  width,
  height,
}: GridImagePreviewProps) {
  const hasKnownRatio =
    typeof width === "number" &&
    typeof height === "number" &&
    width > 0 &&
    height > 0;
  return (
    <div
      className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border bg-card"
      style={
        hasKnownRatio && width && height
          ? { aspectRatio: width / height }
          : undefined
      }
    >
      {imageUrl ? (
        <Image
          alt={altText ?? "Image"}
          className="absolute inset-0 h-full w-full"
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          loading="lazy"
          height={hasKnownRatio && height ? height : 300}
          width={hasKnownRatio && width ? width : 400}
          preview={false}
          rootClassName="absolute inset-0 h-full w-full"
          src={imageUrl}
          style={{
            objectFit: hasKnownRatio ? "cover" : "contain",
            position: "absolute",
            inset: 0,
            height: "100%",
            width: "100%",
          }}
        />
      ) : (
        <div aria-hidden className="h-full w-full bg-muted" />
      )}
    </div>
  );
}
