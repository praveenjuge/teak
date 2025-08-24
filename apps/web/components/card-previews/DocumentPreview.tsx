import { Archive, Code, File, FileText } from "lucide-react";
import { type Doc } from "@teak/convex/_generated/dataModel";

// Large/rich previews for the modal
function getDocumentIcon(fileName: string, mimeType: string) {
  const name = (fileName || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();

  if (mime.includes("pdf")) {
    return <FileText className="size-4 text-destructive" />;
  }
  if (
    mime.includes("word") ||
    name.endsWith(".doc") ||
    name.endsWith(".docx")
  ) {
    return <FileText className="size-4 text-blue-500" />;
  }
  if (
    mime.includes("excel") ||
    name.endsWith(".xls") ||
    name.endsWith(".xlsx")
  ) {
    return <FileText className="size-4 text-green-500" />;
  }
  if (
    mime.includes("powerpoint") ||
    name.endsWith(".ppt") ||
    name.endsWith(".pptx")
  ) {
    return <FileText className="size-4 text-orange-500" />;
  }
  if (
    mime.includes("zip") ||
    mime.includes("rar") ||
    name.endsWith(".7z") ||
    name.endsWith(".tar.gz")
  ) {
    return <Archive className="size-4 text-yellow-500" />;
  }
  if (
    name.endsWith(".js") ||
    name.endsWith(".ts") ||
    name.endsWith(".py") ||
    name.endsWith(".html") ||
    name.endsWith(".css") ||
    name.endsWith(".json") ||
    name.endsWith(".xml")
  ) {
    return <Code className="size-4 text-green-500" />;
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".rtf")) {
    return <FileText className="size-4 text-muted-foreground" />;
  }
  return <File className="size-4 text-muted-foreground" />;
}

interface DocumentPreviewProps {
  card: Doc<"cards">;
}

export function DocumentPreview({ card }: DocumentPreviewProps) {
  const fileName = card.metadata?.fileName || card.content || "Document";
  const mimeType = card.metadata?.mimeType || "";

  return (
    <div className="flex items-center gap-4 p-4">
      <div className="flex-shrink-0">{getDocumentIcon(fileName, mimeType)}</div>
      <div className="min-w-0">
        <p className="font-medium text-lg truncate">{fileName}</p>
        {mimeType && (
          <p className="text-muted-foreground truncate">{mimeType}</p>
        )}
      </div>
    </div>
  );
}
