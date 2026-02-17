import { Image } from "antd";
import type { SyntheticEvent } from "react";

interface LinkImageDisplayProps {
  fallbackImageSize?: { width: number; height: number };
  fallbackImageUrl?: string;
  linkCardTitle: string;
  primaryImageSize?: { width: number; height: number };
  primaryImageUrl?: string;
}

export function LinkImageDisplay({
  linkCardTitle,
  primaryImageUrl,
  primaryImageSize,
  fallbackImageUrl,
  fallbackImageSize,
}: LinkImageDisplayProps) {
  const hasPrimaryImage = !!(primaryImageUrl && primaryImageSize);
  const hasFallbackImage = !!(fallbackImageUrl && fallbackImageSize);

  if (hasPrimaryImage) {
    return (
      <div
        className="w-full overflow-hidden"
        style={{
          aspectRatio: primaryImageSize!.width / primaryImageSize!.height,
        }}
      >
        <Image
          alt={linkCardTitle}
          className="h-full w-full object-cover"
          placeholder
          preview={false}
          rootClassName="h-full w-full"
          src={primaryImageUrl}
        />
      </div>
    );
  }

  if (hasFallbackImage) {
    return (
      <div
        className="w-full overflow-hidden"
        style={{
          aspectRatio: fallbackImageSize!.width / fallbackImageSize!.height,
        }}
      >
        <Image
          alt={linkCardTitle}
          className="h-full w-full object-cover"
          placeholder
          preview={false}
          rootClassName="h-full w-full"
          src={fallbackImageUrl}
        />
      </div>
    );
  }

  return null;
}

interface LinkCardWithImageProps {
  displayImage?: string;
  displayImageSize?: { width: number; height: number };
  linkCardTitle: string;
  onImageError?: (event: SyntheticEvent<HTMLImageElement>) => void;
}

export function LinkCardWithImage({
  linkCardTitle,
  displayImage,
  displayImageSize,
  onImageError,
}: LinkCardWithImageProps) {
  if (displayImage && displayImageSize) {
    return (
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        <div
          className="w-full overflow-hidden"
          style={{
            aspectRatio: displayImageSize.width / displayImageSize.height,
          }}
        >
          <Image
            alt={linkCardTitle}
            className="h-full w-full object-cover"
            onError={onImageError}
            placeholder
            preview={false}
            rootClassName="h-full w-full"
            src={displayImage}
          />
        </div>
        <div className="px-4 py-3">
          <p className="max-w-full truncate font-medium">{linkCardTitle}</p>
        </div>
      </div>
    );
  }

  if (displayImage) {
    return (
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        <div className="h-28 min-h-28 overflow-hidden">
          <Image
            alt={linkCardTitle}
            className="h-full w-full object-cover"
            onError={onImageError}
            placeholder
            preview={false}
            rootClassName="h-full w-full"
            src={displayImage}
          />
        </div>
        <div className="px-4 py-3">
          <p className="max-w-full truncate font-medium">{linkCardTitle}</p>
        </div>
      </div>
    );
  }

  return (
    <p className="w-full min-w-0 overflow-hidden truncate text-ellipsis whitespace-nowrap rounded-xl border bg-card p-4 font-medium">
      {linkCardTitle}
    </p>
  );
}
