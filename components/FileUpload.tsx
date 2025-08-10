import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, File, X, Image as ImageIcon, Video, FileText, Archive, Code, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// File type categorization
const getFileCategory = (file: File): 'image' | 'video' | 'audio' | 'document' | 'archive' | 'code' | 'other' => {
  const mimeType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();
  
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  
  // Document types
  if (mimeType.includes('pdf') || 
      mimeType.includes('word') || 
      mimeType.includes('powerpoint') || 
      mimeType.includes('excel') || 
      mimeType.includes('sheet') ||
      mimeType.includes('text') ||
      fileName.endsWith('.txt') ||
      fileName.endsWith('.md') ||
      fileName.endsWith('.rtf')) {
    return 'document';
  }
  
  // Archive types
  if (mimeType.includes('zip') || 
      mimeType.includes('rar') || 
      mimeType.includes('7z') ||
      fileName.endsWith('.tar.gz')) {
    return 'archive';
  }
  
  // Code files
  if (fileName.endsWith('.js') || 
      fileName.endsWith('.ts') || 
      fileName.endsWith('.py') || 
      fileName.endsWith('.html') || 
      fileName.endsWith('.css') || 
      fileName.endsWith('.json') || 
      fileName.endsWith('.xml')) {
    return 'code';
  }
  
  return 'other';
};

const getFileIcon = (file: File) => {
  const category = getFileCategory(file);
  
  switch (category) {
    case 'image': return <ImageIcon className="w-8 h-8 text-purple-500" />;
    case 'video': return <Video className="w-8 h-8 text-red-500" />;
    case 'audio': return <Music className="w-8 h-8 text-orange-500" />;
    case 'document': return <FileText className="w-8 h-8 text-blue-500" />;
    case 'archive': return <Archive className="w-8 h-8 text-yellow-500" />;
    case 'code': return <Code className="w-8 h-8 text-green-500" />;
    default: return <File className="w-8 h-8 text-gray-500" />;
  }
};

interface FileUploadProps {
  accept?: string;
  onFileSelect: (file: File | null) => void;
  selectedFile: File | null;
  className?: string;
  maxSize?: number; // in bytes
}

export function FileUpload({
  accept = "*/*",
  onFileSelect,
  selectedFile,
  className,
  maxSize = 200 * 1024 * 1024, // 200MB default for documents
}: FileUploadProps) {
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: any[]) => {
      setError(null);
      
      if (rejectedFiles.length > 0) {
        const rejection = rejectedFiles[0];
        if (rejection.errors.some((err: any) => err.code === "file-too-large")) {
          setError(`File is too large. Maximum size is ${Math.round(maxSize / (1024 * 1024))}MB`);
        } else if (rejection.errors.some((err: any) => err.code === "file-invalid-type")) {
          setError("File type is not supported");
        } else {
          setError("File upload failed");
        }
        return;
      }

      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        onFileSelect(file);
        
        // Generate preview for images
        if (file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = (e) => {
            setPreview(e.target?.result as string);
          };
          reader.readAsDataURL(file);
        } else {
          setPreview(null);
        }
      }
    },
    [onFileSelect, maxSize]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: accept ? { [accept]: [] } : undefined,
    maxFiles: 1,
    maxSize,
  });

  const removeFile = () => {
    onFileSelect(null);
    setPreview(null);
    setError(null);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };


  if (selectedFile) {
    return (
      <div className={cn("border border-gray-200 rounded-lg p-4", className)}>
        <div className="flex items-start gap-3">
          {preview ? (
            <img
              src={preview}
              alt="Preview"
              className="w-16 h-16 object-cover rounded-lg"
            />
          ) : (
            getFileIcon(selectedFile)
          )}
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {selectedFile.name}
            </p>
            <p className="text-xs text-gray-500">
              {formatFileSize(selectedFile.size)}
            </p>
            <p className="text-xs text-gray-400 capitalize">
              {getFileCategory(selectedFile)} file
            </p>
          </div>
          
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={removeFile}
            className="h-8 w-8 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("", className)}>
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
          isDragActive
            ? "border-blue-400 bg-blue-50"
            : "border-gray-300 hover:border-gray-400"
        )}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-2">
          <Upload className={cn(
            "w-8 h-8",
            isDragActive ? "text-blue-500" : "text-gray-400"
          )} />
          <div>
            <p className="text-sm font-medium text-gray-900">
              {isDragActive ? "Drop your file here" : "Click to upload or drag and drop"}
            </p>
            <p className="text-xs text-gray-500">
              Max file size: {Math.round(maxSize / (1024 * 1024))}MB
            </p>
          </div>
        </div>
      </div>
      
      {error && (
        <p className="mt-2 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}