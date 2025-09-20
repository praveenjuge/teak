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

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

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
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Card Information</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Timestamps */}
          <div className="space-y-3">
            <Label className="text-base font-semibold">Timestamps</Label>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created:</span>
                <span className="font-medium">
                  {formatDate(card.createdAt)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Updated:</span>
                <span className="font-medium">
                  {formatDate(card.updatedAt)}
                </span>
              </div>
            </div>
          </div>

          {/* URL Information */}
          {card.url && (
            <div className="space-y-3">
              <Label className="text-base font-semibold">URL</Label>
              <div className="p-3 bg-muted/50 rounded-md">
                <div className="flex items-start gap-2">
                  <div className="flex-1 break-all text-sm font-mono">
                    {card.url}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(card.url!, "url")}
                    className="flex-shrink-0"
                  >
                    <Copy className="size-4" />
                    {copiedField === "url" ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Original Content */}
          {card.content && (
            <div className="space-y-3">
              <Label className="text-base font-semibold">
                Original Content
              </Label>
              <div className="p-3 bg-muted/50 rounded-md">
                <div className="flex items-start gap-2">
                  <div className="flex-1 text-sm whitespace-pre-wrap">
                    {card.content}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(card.content!, "content")}
                    className="flex-shrink-0"
                  >
                    <Copy className="size-4" />
                    {copiedField === "content" ? "Copied!" : "Copy"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* File Metadata */}
          {card.fileMetadata && (
            <div className="space-y-3">
              <Label className="text-base font-semibold">
                File Information
              </Label>
              <div className="space-y-2 text-sm">
                {card.fileMetadata.fileName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">File Name:</span>
                    <span className="font-medium font-mono text-right max-w-[60%] break-all">
                      {card.fileMetadata.fileName}
                    </span>
                  </div>
                )}
                {card.fileMetadata.fileSize && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">File Size:</span>
                    <span className="font-medium">
                      {(card.fileMetadata.fileSize / (1024 * 1024)).toFixed(2)}{" "}
                      MB
                    </span>
                  </div>
                )}
                {card.fileMetadata.mimeType && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">File Type:</span>
                    <span className="font-medium font-mono">
                      {card.fileMetadata.mimeType}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
