import { Upload, AlertCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { DragDropState } from "@/hooks/useGlobalDragDrop";

interface DragOverlayProps {
  dragDropState: DragDropState;
  canCreateCard: boolean;
}

export function DragOverlay({
  dragDropState,
  canCreateCard,
}: DragOverlayProps) {
  const { isDragActive, isDragReject, isUploading, uploadProgress } =
    dragDropState;

  if (!isDragActive && !isUploading) {
    return null;
  }

  // Uploading state
  if (isUploading) {
    return (
      <div className="fixed inset-0 z-50 bg-background/10 backdrop-blur-sm">
        <div className="flex h-full items-center justify-center">
          <div className="bg-background rounded-lg p-8 max-w-md w-full mx-4 text-center space-y-4">
            <Upload className="mx-auto size-6 text-primary animate-pulse" />
            <div className="space-y-1">
              <h3 className="font-semibold">Uploading file...</h3>
              <p className="text-muted-foreground">
                Please wait while we process your file
              </p>
            </div>
            <Progress value={uploadProgress} className="w-full" />
            <p className="text-muted-foreground">{uploadProgress}% complete</p>
          </div>
        </div>
      </div>
    );
  }

  // Drag active state
  const getOverlayContent = () => {
    if (!canCreateCard) {
      return {
        icon: AlertCircle,
        title: "Cannot upload files",
        description: "Card limit reached. Upgrade to Pro for unlimited cards.",
        bgColor: "bg-destructive/10",
        iconColor: "text-destructive",
      };
    }

    if (isDragReject) {
      return {
        icon: AlertCircle,
        title: "File type not supported",
        description: "Please drop image, video, audio, or document files",
        bgColor: "bg-destructive/10",
        iconColor: "text-destructive",
      };
    }

    return {
      icon: Upload,
      title: "Drop files to create cards",
      description: "Supports images, videos, audio, and documents",
      bgColor: "bg-primary/10",
      iconColor: "text-primary",
    };
  };

  const {
    icon: Icon,
    title,
    description,
    bgColor,
    iconColor,
  } = getOverlayContent();

  return (
    <div className={`fixed inset-0 z-50 ${bgColor} backdrop-blur-sm`}>
      <div className="flex h-full items-center justify-center">
        <div className="bg-background rounded-lg p-8 max-w-md w-full mx-4 text-center space-y-4">
          <Icon className={`mx-auto size-6 ${iconColor}`} />
          <div className="space-y-1">
            <h3 className="font-semibold">{title}</h3>
            <p className="text-muted-foreground">{description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
