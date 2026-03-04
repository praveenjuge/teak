import { Upload } from "lucide-react";

interface DragOverlayProps {
  isDragActive: boolean;
}

export function DragOverlay({ isDragActive }: DragOverlayProps) {
  if (!isDragActive) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/80 backdrop-blur-sm">
      <div className="text-center text-primary-foreground">
        <Upload className="mx-auto mb-4 size-8" />
        <p className="font-medium text-xl">Drop files to upload</p>
      </div>
    </div>
  );
}
