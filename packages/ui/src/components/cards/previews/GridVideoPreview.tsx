import { Image } from "antd";
import { Play } from "lucide-react";

interface GridVideoPreviewProps {
  thumbnailUrl?: string;
}

export function GridVideoPreview({ thumbnailUrl }: GridVideoPreviewProps) {
  if (thumbnailUrl) {
    return (
      <div className="relative overflow-hidden rounded-xl border bg-card">
        <Image
          alt="Video thumbnail"
          className="w-full object-cover"
          loading="lazy"
          placeholder
          preview={false}
          src={thumbnailUrl}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="rounded-full bg-black/50 p-2">
            <Play className="size-6 text-white" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-32 w-full items-center justify-center rounded-xl border bg-black text-white">
      <Play className="size-6 text-white" />
    </div>
  );
}
