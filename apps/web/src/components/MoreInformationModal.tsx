import { Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface CardData {
  createdAt: number;
  updatedAt: number;
  url?: string;
  content?: string;
  fileMetadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
  };
  type?: string;
}

interface MoreInformationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: CardData | null;
}

interface CopyableSectionProps {
  label: string;
  value: string;
  fieldName: string;
  textClass?: string;
  copiedField: string | null;
  onCopy: (field: string) => void;
}

function CopyableSection({
  label,
  value,
  fieldName,
  textClass,
  copiedField,
  onCopy,
}: CopyableSectionProps) {
  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground">{label}</Label>
      <div className="flex items-center justify-between gap-2">
        <p className={`font-medium ${textClass || ""}`}>{value}</p>
        <Button
          aria-label={`Copy ${label}`}
          className="shrink-0"
          onClick={() => onCopy(fieldName)}
          size="icon"
          variant="ghost"
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      {copiedField === fieldName && (
        <p className="text-muted-foreground text-xs">Copied!</p>
      )}
    </div>
  );
}

function KeyValueSection({
  fields,
}: {
  fields: { label: string; value: string; valueClass?: string }[];
}) {
  return (
    <div className="space-y-3 text-sm">
      {fields.map(({ label: fieldLabel, value, valueClass }) => (
        <div className="flex justify-between" key={fieldLabel}>
          <Label className="text-muted-foreground">{fieldLabel}</Label>
          <span className={`font-medium ${valueClass || ""}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

export function MoreInformationModal({
  open,
  onOpenChange,
  card,
}: MoreInformationModalProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const handleCopy = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      console.error("Failed to copy text:", error);
    }
  };

  if (!card) {
    return null;
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>More Information</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <KeyValueSection
            fields={[
              { label: "Created At", value: formatDate(card.createdAt) },
              { label: "Updated At", value: formatDate(card.updatedAt) },
              ...(card.fileMetadata
                ? [
                    ...(card.fileMetadata.fileName
                      ? [
                          {
                            label: "File Name",
                            value: card.fileMetadata.fileName,
                          },
                        ]
                      : []),
                    ...(card.fileMetadata.fileSize
                      ? [
                          {
                            label: "File Size",
                            value: `${(card.fileMetadata.fileSize / (1024 * 1024)).toFixed(2)} MB`,
                          },
                        ]
                      : []),
                    ...(card.fileMetadata.mimeType
                      ? [
                          {
                            label: "File Type",
                            value: card.fileMetadata.mimeType,
                          },
                        ]
                      : []),
                  ]
                : []),
            ]}
          />

          {card.url && (
            <CopyableSection
              copiedField={copiedField}
              fieldName="url"
              label="URL"
              onCopy={(field) => handleCopy(card.url as string, field)}
              textClass="break-all"
              value={card.url}
            />
          )}

          {card.content && (
            <CopyableSection
              copiedField={copiedField}
              fieldName="content"
              label="Original Content"
              onCopy={(field) => handleCopy(card.content as string, field)}
              textClass="whitespace-pre-wrap"
              value={card.content}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
