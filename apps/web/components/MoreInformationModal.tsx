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

  const CopyableSection = ({
    label,
    value,
    fieldName,
    textClass = "",
  }: {
    label: string;
    value: string;
    fieldName: string;
    textClass?: string;
  }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground">{label}</Label>
        <Button
          variant="ghost"
          size="sm"
          className="p-0 h-0 hover:bg-transparent"
          onClick={() => handleCopy(value, fieldName)}
        >
          <Copy />
          {copiedField === fieldName ? "Copied!" : "Copy"}
        </Button>
      </div>
      <div className={`flex-1 font-medium ${textClass}`}>{value}</div>
    </div>
  );

  const KeyValueSection = ({
    label,
    fields,
  }: {
    label?: string;
    fields: { label: string; value: string; valueClass?: string }[];
  }) => (
    <div className="space-y-3 text-sm">
      {fields.map(({ label: fieldLabel, value, valueClass }) => (
        <div key={fieldLabel} className="flex justify-between">
          <Label className="text-muted-foreground">{fieldLabel}</Label>
          <span className={`font-medium ${valueClass || ""}`}>{value}</span>
        </div>
      ))}
    </div>
  );

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
              textClass="break-all"
            />
          )}

          {card.content && (
            <CopyableSection
              label="Original Content"
              value={card.content}
              fieldName="content"
              textClass="whitespace-pre-wrap"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
