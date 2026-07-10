"use client";

import type { Doc } from "@teak/convex/_generated/dataModel";
import { inferFileFormat } from "@teak/convex/shared/file-formats";
import { Button } from "@teak/ui/components/ui/button";
import { Archive, Code, ExternalLink, File, FileText } from "lucide-react";
import { FileTextPreview } from "./FileTextPreview";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface DocumentPreviewProps {
  card: CardWithUrls;
}

const previewFactLabels = (card: CardWithUrls): string[] => {
  const preview = card.fileMetadata?.preview;
  if (!preview) {
    return [];
  }

  const facts: string[] = [];
  if (typeof preview.slideCount === "number") {
    facts.push(`${preview.slideCount} slides`);
  }
  if (typeof preview.archiveFileCount === "number") {
    facts.push(`${preview.archiveFileCount} files`);
  }
  if (typeof preview.archiveDirectoryCount === "number") {
    facts.push(`${preview.archiveDirectoryCount} folders`);
  }
  if (typeof preview.colorVariableCount === "number") {
    facts.push(`${preview.colorVariableCount} color variables`);
  }
  return facts;
};

const iconForKind = (kind?: string) => {
  if (kind === "archive") {
    return Archive;
  }
  if (["markdown", "source", "tokens"].includes(kind ?? "")) {
    return Code;
  }
  if (["office", "pdf", "text"].includes(kind ?? "")) {
    return FileText;
  }
  return File;
};

export function DocumentPreview({ card }: DocumentPreviewProps) {
  const fileName = card.fileMetadata?.fileName || card.content || "Document";
  const mimeType = card.fileMetadata?.mimeType || "";
  const fileUrl = card.fileUrl;
  const format = inferFileFormat({ fileName, mimeType });

  if (format?.preview === "pdf" && fileUrl) {
    return (
      <div className="flex h-full w-full flex-col">
        <iframe
          className="h-full w-full rounded-lg"
          src={fileUrl}
          title={fileName}
        />
      </div>
    );
  }

  const Icon = iconForKind(format?.kind ?? card.fileMetadata?.kind);
  const facts = previewFactLabels(card);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border p-4">
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{fileName}</p>
          <p className="text-muted-foreground text-xs">
            {[format?.language, format?.kind, ...facts]
              .filter(Boolean)
              .join(" · ") || "File"}
          </p>
        </div>
        {fileUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={fileUrl} rel="noopener noreferrer" target="_blank">
              <ExternalLink data-icon="inline-start" />
              Open file
            </a>
          </Button>
        ) : null}
      </div>

      {fileUrl && format && ["markdown", "source"].includes(format.preview) ? (
        <FileTextPreview fileUrl={fileUrl} format={format} />
      ) : null}
    </div>
  );
}
