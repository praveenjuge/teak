import { Archive, Code, File, FileText } from "lucide-react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "@teak/convex";
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

function isPdf(fileName: string, mimeType: string): boolean {
  const name = (fileName || "").toLowerCase();
  const mime = (mimeType || "").toLowerCase();
  return mime.includes("pdf") || name.endsWith(".pdf");
}

interface DocumentPreviewProps {
  card: Doc<"cards">;
}

export function DocumentPreview({ card }: DocumentPreviewProps) {
  const fileName = card.fileMetadata?.fileName || card.content || "Document";
  const mimeType = card.fileMetadata?.mimeType || "";

  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId } : "skip"
  );

  // For PDFs, show embedded viewer
  if (isPdf(fileName, mimeType) && fileUrl) {
    return (
      <div className="w-full h-full flex flex-col">
        <iframe
          src={fileUrl}
          title={fileName}
          className="w-full h-full rounded-lg"
        />
      </div>
    );
  }

  // For other documents, show icon and file info
  return (
    <div className="flex items-center gap-4">
      <div className="shrink-0">{getDocumentIcon(fileName, mimeType)}</div>
      <p className="font-medium truncate min-w-0">{fileName}</p>
    </div>
  );
}
