import { Image } from "antd";

interface GridImagePreviewProps {
  altText?: string;
  height?: number;
  imageUrl?: string;
  width?: number;
}

export function GridImagePreview({
  imageUrl,
  altText,
  width,
  height,
}: GridImagePreviewProps) {
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-xl border bg-card"
      style={{ aspectRatio: width && height ? width / height : 4 / 3 }}
    >
      {imageUrl && (
        <Image
          alt={altText ?? "Image"}
          className="h-full w-full object-cover"
          loading="lazy"
          placeholder
          preview={false}
          rootClassName="h-full w-full"
          src={imageUrl}
          style={{ objectFit: "cover" }}
        />
      )}
      {!imageUrl && (
        <Image
          alt=""
          className="h-full! w-full scale-105"
          placeholder
          rootClassName="h-full w-full"
        />
      )}
    </div>
  );
}
