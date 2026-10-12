import { Button } from "@teak/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { Label } from "@teak/ui/components/ui/label";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { formatExifFields, type ImageExif } from "../../lib/exif";
import { formatPublishedDate } from "../../lib/linkByline";
import { formatBytes } from "../settings/importExportFormat";

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function handleCopy(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch (error) {
    console.error("Failed to copy text:", error);
    toast.error("Failed to copy");
  }
}

interface CardData {
  content?: string;
  createdAt: number;
  fileMetadata?: {
    exif?: ImageExif;
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
  metadata?: {
    linkPreview?: {
      author?: string;
      publishedAt?: string;
      publisher?: string;
      status?: string;
    };
  };
  type?: string;
  updatedAt: number;
  url?: string;
}

interface MoreInformationModalProps {
  card: CardData | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

interface Field {
  label: string;
  value: string;
}

interface CopyableSectionProps {
  label: string;
  onCopy: () => void;
  textClass?: string;
  value: string;
}

function CopyableSection({
  label,
  value,
  textClass,
  onCopy,
}: CopyableSectionProps) {
  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground">{label}</Label>
      <div className="flex items-center justify-between gap-2">
        <p className={`min-w-0 font-medium ${textClass || ""}`}>{value}</p>
        <Button
          aria-label={`Copy ${label.toLowerCase()}`}
          className="shrink-0"
          onClick={onCopy}
          size="icon"
          variant="ghost"
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function KeyValueSection({
  fields,
  title,
}: {
  fields: Field[];
  title?: string;
}) {
  if (fields.length === 0) {
    return null;
  }
  return (
    <section
      aria-label={title}
      className="space-y-3 border-t pt-4 text-sm first:border-t-0 first:pt-0"
    >
      {title && (
        <h3 className="font-medium text-muted-foreground text-xs">{title}</h3>
      )}
      <dl className="space-y-3">
        {fields.map(({ label, value }) => (
          <div
            className="flex items-baseline justify-between gap-4"
            key={label}
          >
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd
              className="min-w-0 truncate text-right font-medium"
              title={value}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const present = (fields: Array<{ label: string; value?: string | null }>) =>
  fields.filter((field): field is Field => Boolean(field.value?.trim()));

/** The facts the More information dialog lists, grouped as it shows them. */
export function getMoreInformationSections(card: CardData) {
  const file = card.fileMetadata;
  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  return {
    details: present([
      { label: "Created", value: formatDate(card.createdAt) },
      { label: "Updated", value: formatDate(card.updatedAt) },
      { label: "File name", value: file?.fileName },
      {
        label: "File size",
        value: file?.fileSize ? formatBytes(file.fileSize) : undefined,
      },
      { label: "File type", value: file?.mimeType },
    ]),
    source: present([
      { label: "Author", value: linkPreview?.author },
      { label: "Publisher", value: linkPreview?.publisher },
      {
        label: "Published",
        value: formatPublishedDate(linkPreview?.publishedAt),
      },
    ]),
    camera: card.type === "image" ? formatExifFields(file?.exif) : [],
  };
}

export function MoreInformationModal({
  open,
  onOpenChange,
  card,
}: MoreInformationModalProps) {
  if (!card) {
    return null;
  }

  const sections = getMoreInformationSections(card);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>More information</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-4">
            <KeyValueSection fields={sections.details} />
            <KeyValueSection fields={sections.source} title="Source" />
            <KeyValueSection fields={sections.camera} title="Photo" />
          </div>

          {card.url && (
            <CopyableSection
              label="URL"
              onCopy={() => handleCopy(card.url as string, "Copied URL")}
              textClass="break-all"
              value={card.url}
            />
          )}

          {card.content && (
            <CopyableSection
              label="Original content"
              onCopy={() =>
                handleCopy(card.content as string, "Copied content")
              }
              textClass="whitespace-pre-wrap break-words"
              value={card.content}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
