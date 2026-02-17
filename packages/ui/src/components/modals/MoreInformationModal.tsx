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

interface CardData {
  content?: string;
  createdAt: number;
  fileMetadata?: {
    fileName?: string;
    fileSize?: number;
    mimeType?: string;
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
        <p className={`font-medium ${textClass || ""}`}>{value}</p>
        <Button
          aria-label={`Copy ${label}`}
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
  const formatDate = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const handleCopy = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch (error) {
      console.error("Failed to copy text:", error);
      toast.error("Failed to copy");
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
              label="URL"
              onCopy={() => handleCopy(card.url as string, "Copied URL")}
              textClass="break-all"
              value={card.url}
            />
          )}

          {card.content && (
            <CopyableSection
              label="Original Content"
              onCopy={() =>
                handleCopy(card.content as string, "Copied content")
              }
              textClass="whitespace-pre-wrap"
              value={card.content}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
