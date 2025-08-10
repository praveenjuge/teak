import { useState } from "react";
import { useQuery } from "convex/react";
import {
  Archive,
  Code,
  Download,
  ExternalLink,
  File,
  FileText,
  Pause,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import type { CardData } from "@/lib/types";

// File type categorization for documents
const getDocumentIcon = (fileName: string, mimeType: string) => {
  const name = fileName.toLowerCase();
  const mime = mimeType.toLowerCase();

  if (mime.includes("pdf")) {
    return <FileText className="w-8 h-8 text-red-500" />;
  }
  if (
    mime.includes("word") || name.endsWith(".doc") || name.endsWith(".docx")
  ) {
    return <FileText className="w-8 h-8 text-blue-500" />;
  }
  if (
    mime.includes("excel") || name.endsWith(".xls") || name.endsWith(".xlsx")
  ) {
    return <FileText className="w-8 h-8 text-green-500" />;
  }
  if (
    mime.includes("powerpoint") ||
    name.endsWith(".ppt") ||
    name.endsWith(".pptx")
  ) {
    return <FileText className="w-8 h-8 text-orange-500" />;
  }
  if (
    mime.includes("zip") ||
    mime.includes("rar") ||
    name.endsWith(".7z") ||
    name.endsWith(".tar.gz")
  ) {
    return <Archive className="w-8 h-8 text-yellow-500" />;
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
    return <Code className="w-8 h-8 text-green-500" />;
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".rtf")) {
    return <FileText className="w-8 h-8 text-gray-500" />;
  }

  return <File className="w-8 h-8 text-gray-500" />;
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// Text Card Component
export function TextCard({ card }: { card: CardData }) {
  return (
    <div className="space-y-2">
      {card.content && (
        <p className="text-gray-700 whitespace-pre-wrap">{card.content}</p>
      )}
    </div>
  );
}

// Link Card Component
export function LinkCard(
  { card, preview = false }: { card: CardData; preview?: boolean },
) {
  const openLink = () => {
    if (card.url) {
      window.open(card.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="space-y-3">
      {/* Link Preview */}
      <div
        onClick={preview ? undefined : openLink}
        className={`border border-gray-200 rounded-lg p-3 ${
          preview ? "" : "cursor-pointer hover:bg-gray-50 transition-colors"
        }`}
      >
        <div className="flex items-start gap-3">
          {card.metadata?.linkFavicon && (
            <img
              src={card.metadata.linkFavicon}
              alt=""
              className="w-4 h-4 mt-0.5 flex-shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <h4 className="font-medium text-gray-900 text-sm line-clamp-1">
              {card.metadata?.linkTitle || card.title || "Link"}
            </h4>
            {card.metadata?.linkDescription && (
              <p className="text-gray-600 text-xs mt-1 line-clamp-2">
                {card.metadata.linkDescription}
              </p>
            )}
            <p className="text-gray-400 text-xs mt-1 truncate">{card.url}</p>
          </div>
          <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0" />
        </div>
        {card.metadata?.linkImage && (
          <img
            src={card.metadata.linkImage}
            alt=""
            className="w-full h-32 object-cover rounded mt-3"
          />
        )}
      </div>

      {card.content && <p className="text-gray-700 text-sm">{card.content}</p>}
    </div>
  );
}

// Image Card Component
export function ImageCard({ card }: { card: CardData }) {
  const [isLoading, setIsLoading] = useState(true);
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId as Id<"_storage"> } : "skip",
  );

  if (!fileUrl) return null;

  return (
    <div className="space-y-2">
      <div className="relative">
        {isLoading && (
          <div className="absolute inset-0 bg-gray-100 animate-pulse rounded-lg" />
        )}
        <img
          src={fileUrl}
          alt={card.title || card.content}
          className="w-full h-48 object-cover rounded-lg"
          onLoad={() => setIsLoading(false)}
          onError={() => setIsLoading(false)}
        />
      </div>

      {card.content && <p className="text-gray-700 text-sm">{card.content}</p>}

      {card.metadata?.fileSize && (
        <p className="text-gray-400 text-xs">
          {(card.metadata.fileSize / (1024 * 1024)).toFixed(1)} MB
        </p>
      )}
    </div>
  );
}

// Video Card Component
export function VideoCard({ card }: { card: CardData }) {
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId as Id<"_storage"> } : "skip",
  );

  if (!fileUrl) return null;

  return (
    <div className="space-y-2">
      <video
        controls
        className="w-full h-48 object-cover rounded-lg bg-black"
        preload="metadata"
      >
        <source src={fileUrl} type={card.metadata?.mimeType} />
        Your browser does not support the video tag.
      </video>

      {card.content && <p className="text-gray-700 text-sm">{card.content}</p>}

      <div className="flex items-center gap-4 text-xs text-gray-400">
        {card.metadata?.fileSize && (
          <span>{(card.metadata.fileSize / (1024 * 1024)).toFixed(1)} MB</span>
        )}
        {card.metadata?.duration && (
          <span>{Math.round(card.metadata.duration)}s</span>
        )}
      </div>
    </div>
  );
}

// Audio Card Component
export function AudioCard(
  { card, preview = false }: { card: CardData; preview?: boolean },
) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId ? { fileId: card.fileId as Id<"_storage"> } : "skip",
  );

  if (!fileUrl) return null;

  const togglePlayPause = () => {
    const audio = document.getElementById(
      `audio-${card._id}`,
    ) as HTMLAudioElement;
    if (audio) {
      if (isPlaying) {
        audio.pause();
      } else {
        audio.play();
      }
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const downloadAudio = () => {
    if (fileUrl) {
      const a = document.createElement("a");
      a.href = fileUrl;
      a.download = card.metadata?.fileName || `audio-${card._id}.webm`;
      a.click();
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-3">
          <Button
            type="button"
            size="sm"
            onClick={preview ? undefined : togglePlayPause}
            disabled={preview}
            className="rounded-full w-10 h-10 p-0"
          >
            {isPlaying
              ? <Pause className="w-4 h-4" />
              : <Play className="w-4 h-4" />}
          </Button>

          <div className="flex-1">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <Progress
              value={duration > 0 ? (currentTime / duration) * 100 : 0}
              className="w-full"
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={preview ? undefined : downloadAudio}
            disabled={preview}
            className="p-2"
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>

        <audio
          id={`audio-${card._id}`}
          src={fileUrl}
          onLoadedMetadata={(e) => {
            const audio = e.currentTarget;
            setDuration(audio.duration);
          }}
          onTimeUpdate={(e) => {
            const audio = e.currentTarget;
            setCurrentTime(audio.currentTime);
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          style={{ display: "none" }}
        />
      </div>

      {card.content && <p className="text-gray-700 text-sm">{card.content}</p>}

      {card.metadata?.fileSize && (
        <p className="text-gray-400 text-xs">
          {(card.metadata.fileSize / (1024 * 1024)).toFixed(1)} MB
        </p>
      )}
    </div>
  );
}
// Document Card Component
export function DocumentCard(
  { card, preview = false }: { card: CardData; preview?: boolean },
) {
  const fileUrl = useQuery(
    api.cards.getFileUrl,
    card.fileId
      ? { fileId: card.fileId as Id<"_storage">, cardId: card._id as Id<"cards"> }
      : "skip",
  );

  const handleDownload = () => {
    if (fileUrl) {
      const a = document.createElement("a");
      a.href = fileUrl;
      a.download = card.metadata?.fileName || `document-${card._id}`;
      a.click();
    }
  };

  const handleView = () => {
    if (fileUrl) {
      window.open(fileUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="space-y-3">
      <div
        className={`border border-gray-200 rounded-lg p-4 ${
          preview ? "" : "hover:bg-gray-50 transition-colors"
        }`}
      >
        <div className="flex items-start gap-3">
          {/* File Icon */}
          <div className="flex-shrink-0">
            {getDocumentIcon(
              card.metadata?.fileName || card.content,
              card.metadata?.mimeType || "",
            )}
          </div>

          {/* File Info */}
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-gray-900 text-sm truncate">
              {card.metadata?.fileName || card.content}
            </h4>

            {card.metadata?.fileSize && (
              <p className="text-gray-500 text-xs mt-1">
                {formatFileSize(card.metadata.fileSize)}
              </p>
            )}

            {card.metadata?.mimeType && (
              <p className="text-gray-400 text-xs capitalize">
                {card.metadata.mimeType.split("/")[1] || "document"}
              </p>
            )}
          </div>

          {/* Action Buttons */}
          {!preview && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleView}
                className="text-xs"
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                View
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="text-xs"
              >
                <Download className="w-3 h-3 mr-1" />
                Download
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
