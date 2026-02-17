import { Image } from "antd";
import { File } from "lucide-react";

interface GridDocumentPreviewProps {
  fileName?: string;
  thumbnailUrl?: string;
}

export function GridDocumentPreview({
  thumbnailUrl,
  fileName,
}: GridDocumentPreviewProps) {
  if (thumbnailUrl) {
    return (
      <div className="overflow-hidden rounded-xl border bg-card">
        <Image
          alt={`Preview of ${fileName || "document"}`}
          className="w-full bg-muted object-contain"
          loading="lazy"
          placeholder
          preview={false}
          src={thumbnailUrl}
        />
        <div className="flex items-center gap-2 border-t px-4 py-3">
          <File className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-sm">{fileName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card p-4">
      <File className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">{fileName}</span>
    </div>
  );
}
