"use client";

import type { Doc } from "@teak/convex/_generated/dataModel";
import {
  type FileFormat,
  type FileKind,
  inferFileFormat,
} from "@teak/convex/shared/fileFormats";
import type { TeakTranslator } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { Archive, Code, ExternalLink, File, FileText } from "vadivam-react";
import { Button } from "@/components/ui/button";
import { FileTextPreview } from "./FileTextPreview";

type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
};

interface DocumentPreviewProps {
  card: CardWithUrls;
}

const previewFactLabels = (
  card: CardWithUrls,
  t: TeakTranslator<"cardPreviews.document.facts">
): string[] => {
  const preview = card.fileMetadata?.preview;
  if (!preview) {
    return [];
  }

  const facts: string[] = [];
  if (typeof preview.slideCount === "number") {
    facts.push(t("slides", { count: preview.slideCount }));
  }
  if (typeof preview.wordCount === "number") {
    facts.push(t("words", { count: preview.wordCount }));
  }
  if (typeof preview.headingCount === "number" && preview.headingCount > 0) {
    facts.push(t("headings", { count: preview.headingCount }));
  }
  if (typeof preview.lineCount === "number") {
    facts.push(t("lines", { count: preview.lineCount }));
  }
  if (typeof preview.archiveFileCount === "number") {
    facts.push(t("files", { count: preview.archiveFileCount }));
  }
  if (typeof preview.archiveDirectoryCount === "number") {
    facts.push(t("folders", { count: preview.archiveDirectoryCount }));
  }
  if (typeof preview.colorVariableCount === "number") {
    facts.push(t("colorVariables", { count: preview.colorVariableCount }));
  }
  return facts;
};

const KIND_LABEL_KEYS = {
  archive: "archive",
  audio: "audio",
  design: "design",
  image: "image",
  markdown: "markdown",
  motion: "motion",
  office: "office",
  pdf: "pdf",
  source: "source",
  text: "text",
  tokens: "tokens",
} as const satisfies Record<FileKind, string>;

/** Kinds whose label doesn't say which format the file is in. */
const NAMES_FORMAT = new Set<string>([
  "archive",
  "design",
  "office",
  "source",
  "tokens",
]);

/**
 * What the file is, in words people read: "Source code", "JSON · Source
 * code", "CSV · Text file". Never Teak's own ids ("text · text").
 */
export const documentKindLabel = (
  format:
    | Pick<FileFormat, "extension" | "kind" | "language">
    | null
    | undefined,
  storedKind: string | undefined,
  t: TeakTranslator<"cardPreviews.document.kinds">
): string | undefined => {
  const kind = format?.kind ?? storedKind;
  if (!(kind && kind in KIND_LABEL_KEYS)) {
    return;
  }
  const label = t(KIND_LABEL_KEYS[kind as FileKind]);
  const extension = format?.extension.split(".").at(-1)?.toUpperCase();
  const namesFormat =
    NAMES_FORMAT.has(kind) ||
    (format?.language !== undefined &&
      !["markdown", "text"].includes(format.language));
  return extension && namesFormat ? `${extension} · ${label}` : label;
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
  const t = useTranslations("cardPreviews.document");
  const tFacts = useTranslations("cardPreviews.document.facts");
  const tKinds = useTranslations("cardPreviews.document.kinds");
  const fileName = card.fileMetadata?.fileName || card.content || t("untitled");
  const mimeType = card.fileMetadata?.mimeType || "";
  const fileUrl = card.fileUrl;
  const format = inferFileFormat({ fileName, mimeType });

  if (format?.preview === "pdf" && fileUrl) {
    return (
      <div className="flex h-full w-full flex-col">
        <iframe
          className="h-full w-full rounded-xl"
          src={fileUrl}
          title={fileName}
        />
      </div>
    );
  }

  const Icon = iconForKind(format?.kind ?? card.fileMetadata?.kind);
  const facts = previewFactLabels(card, tFacts);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl border p-4">
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{fileName}</p>
          <p className="text-muted-foreground text-xs">
            {[
              documentKindLabel(format, card.fileMetadata?.kind, tKinds),
              ...facts,
            ]
              .filter(Boolean)
              .join(" · ") || t("file")}
          </p>
        </div>
        {fileUrl ? (
          <Button asChild size="sm" variant="outline">
            <a href={fileUrl} rel="noopener noreferrer" target="_blank">
              <ExternalLink data-icon="inline-start" />
              {t("openFile")}
            </a>
          </Button>
        ) : null}
      </div>

      {fileUrl && format && ["markdown", "source"].includes(format.preview) ? (
        <FileTextPreview
          fileKey={card.fileKey}
          fileUrl={fileUrl}
          format={format}
        />
      ) : null}
    </div>
  );
}
