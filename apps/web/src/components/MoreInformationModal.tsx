import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy } from "lucide-react";
import { useState } from "react";

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

type CopyableSectionProps = {
  label: string;
  value: string;
  fieldName: string;
  textClass?: string;
  copiedField: string | null;
  onCopy: (field: string) => void;
};

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
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => onCopy(fieldName)}
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-4 w-4" />
        </Button>
      </div>
      {copiedField === fieldName && (
        <p className="text-xs text-muted-foreground">Copied!</p>
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
        <div key={fieldLabel} className="flex justify-between">
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

  if (!card) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
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
              label="URL"
              value={card.url}
              fieldName="url"
              copiedField={copiedField}
              onCopy={(field) => handleCopy(card.url as string, field)}
              textClass="break-all"
            />
          )}

          {card.content && (
            <CopyableSection
              label="Original Content"
              value={card.content}
              fieldName="content"
              copiedField={copiedField}
              onCopy={(field) => handleCopy(card.content as string, field)}
              textClass="whitespace-pre-wrap"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
