import { useState, useRef } from "react";
import { useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileUpload } from "./FileUpload";
import { AudioRecorder } from "./AudioRecorder";
import {
  Type,
  Link as LinkIcon,
  Upload,
  Mic,
  Plus,
  X,
} from "lucide-react";
import { api } from "../convex/_generated/api";
import type { CardType } from "./Card";

// File type categorization (shared with FileUpload)
const getFileCardType = (file: File): CardType => {
  const mimeType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();
  
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  
  // Everything else becomes a document card
  return 'document';
};

interface AddCardFormProps {
  onSuccess?: () => void;
}

type CombinedTab = "text" | "upload" | "audio";

export function AddCardForm({ onSuccess }: AddCardFormProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<CombinedTab>("text");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Form data
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  
  // File handling
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  
  const createCard = useMutation(api.cards.createCard);
  const generateUploadUrl = useMutation(api.cards.generateUploadUrl);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required fields based on combined tab type
    if (activeTab === "text" && !content.trim()) return;
    if (activeTab === "upload" && !uploadedFile) return;
    if (activeTab === "audio" && !audioBlob) return;
    
    setIsSubmitting(true);
    
    try {
      let fileId: string | undefined;
      let metadata: Record<string, string | number> = {};
      let finalContent = content;
      let finalUrl = url;
      let cardType: CardType;
      
      // Determine actual card type based on content
      if (activeTab === "text") {
        // Smart detection: if content is only a URL, make it a link card
        const trimmedContent = content.trim();
        const urlPattern = /^https?:\/\/[^\s]+$/;
        
        if (urlPattern.test(trimmedContent)) {
          cardType = "link";
          finalUrl = trimmedContent;
          finalContent = trimmedContent; // Keep URL as content for link cards
        } else {
          cardType = "text";
          // Extract URL from text content if present
          const urlMatch = trimmedContent.match(/(https?:\/\/[^\s]+)/);
          if (urlMatch) {
            finalUrl = urlMatch[1];
          }
        }
      } else if (activeTab === "upload") {
        // Determine type based on file MIME type
        cardType = getFileCardType(uploadedFile!);
      } else {
        cardType = "audio";
      }
      
      // Handle file upload
      if (uploadedFile && activeTab === "upload") {
        const uploadUrl = await generateUploadUrl({
          fileName: uploadedFile.name,
          fileType: uploadedFile.type,
        });
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": uploadedFile.type },
          body: uploadedFile,
        });
        const { storageId } = await result.json();
        fileId = storageId;
        
        metadata = {
          fileName: uploadedFile.name,
          fileSize: uploadedFile.size,
          mimeType: uploadedFile.type,
        };
        
        if (!finalContent) {
          finalContent = uploadedFile.name;
        }
      }
      
      // Handle audio recording
      if (audioBlob && activeTab === "audio") {
        const uploadUrl = await generateUploadUrl({
          fileName: `recording_${Date.now()}.webm`,
          fileType: audioBlob.type,
        });
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": audioBlob.type },
          body: audioBlob,
        });
        const { storageId } = await result.json();
        fileId = storageId;
        
        metadata = {
          fileName: `recording_${Date.now()}.webm`,
          fileSize: audioBlob.size,
          mimeType: audioBlob.type,
        };
        
        if (!finalContent) {
          finalContent = "Audio Recording";
        }
      }

      await createCard({
        content: finalContent,
        type: cardType,
        url: finalUrl || undefined,
        fileId: fileId as any, // TODO: Fix Convex types
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      });

      // Reset form
      setContent("");
      setUrl("");
      setUploadedFile(null);
      setAudioBlob(null);
      setIsExpanded(false);
      setActiveTab("text");
      
      onSuccess?.();
    } catch (error) {
      console.error("Failed to create card:", error);
    } finally {
      setIsSubmitting(false);
    }
  };


  const getTabIcon = (type: CombinedTab) => {
    switch (type) {
      case "text": return <Type className="w-4 h-4" />;
      case "upload": return <Upload className="w-4 h-4" />;
      case "audio": return <Mic className="w-4 h-4" />;
    }
  };

  if (!isExpanded) {
    return (
      <div className="mb-6">
        <Button
          onClick={() => {
            setIsExpanded(true);
            setTimeout(() => textareaRef.current?.focus(), 100);
          }}
          variant="outline"
          className="w-full justify-start h-12 text-muted-foreground"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add new content...
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-gray-900">Add New Content</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setIsExpanded(false)}
          className="h-8 w-8"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Content Type Tabs */}
      <div className="flex space-x-1 mb-4 bg-gray-100 rounded-md p-1">
        {(["text", "upload", "audio"] as CombinedTab[]).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setActiveTab(type)}
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === type
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {getTabIcon(type)}
            <span className="capitalize">{type}</span>
          </button>
        ))}
      </div>


      {/* Content based on type */}
      <div className="space-y-4">
        {activeTab === "text" && (
          <div>
            <Label htmlFor="content">Text or Link</Label>
            <Textarea
              id="content"
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write text or paste a link..."
              className="mt-1 min-h-[120px]"
              required
            />
          </div>
        )}

        {activeTab === "upload" && (
          <div>
            <Label>Upload Files</Label>
            <FileUpload
              accept="*/*"
              onFileSelect={setUploadedFile}
              selectedFile={uploadedFile}
              className="mt-1"
              maxSize={200 * 1024 * 1024} // 200MB for documents
            />
            <p className="text-xs text-gray-500 mt-2">
              Supports images, videos, documents, PDFs, archives, and more
            </p>
          </div>
        )}

        {activeTab === "audio" && (
          <div>
            <Label>Record Audio</Label>
            <AudioRecorder
              onRecordingComplete={setAudioBlob}
              audioBlob={audioBlob}
              className="mt-1"
            />
          </div>
        )}
      </div>

      {/* Submit Button */}
      <div className="flex justify-end gap-2 mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsExpanded(false)}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save Content"}
        </Button>
      </div>
    </form>
  );
}