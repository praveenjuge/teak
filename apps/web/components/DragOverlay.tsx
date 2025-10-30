import { Upload, AlertCircle, Sparkles } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import type { DragDropState } from "@/hooks/useGlobalDragDrop";

interface DragOverlayProps {
  dragDropState: DragDropState;
  dismissUpgradePrompt: () => void;
  navigateToUpgrade: () => void;
}

export function DragOverlay({
  dragDropState,
  dismissUpgradePrompt,
  navigateToUpgrade,
}: DragOverlayProps) {
  const {
    isDragActive,
    isDragReject,
    isUploading,
    uploadProgress,
    showUpgradePrompt,
  } = dragDropState;

  if (!isDragActive && !isUploading && !showUpgradePrompt) {
    return null;
  }

  // Upgrade prompt state
  if (showUpgradePrompt) {
    return (
      <div className="fixed inset-0 z-50 bg-background/10 backdrop-blur-sm">
        <div className="flex h-full items-center justify-center">
          <div className="bg-background rounded-lg p-8 max-w-md w-full mx-4 text-center space-y-4 border">
            <div className="flex items-center justify-center gap-2 text-primary">
              <Sparkles className="size-4 fill-primary" />
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Unlock Unlimited Cards</h3>
              <p className="text-muted-foreground">
                You&apos;ve reached your free tier limit. Upgrade to Pro for
                unlimited cards.
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button onClick={navigateToUpgrade} size="sm" className="gap-2">
                <Sparkles className="size-4" />
                Upgrade to Pro
              </Button>
              <Button
                onClick={dismissUpgradePrompt}
                variant="outline"
                size="sm"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Uploading state
  if (isUploading) {
    return (
      <div className="fixed inset-0 z-50 bg-background/10 backdrop-blur-sm">
        <div className="flex h-full items-center justify-center">
          <div className="bg-background rounded-lg p-8 max-w-md w-full mx-4 text-center space-y-4 border">
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
        <div className="bg-background rounded-lg p-8 max-w-md w-full mx-4 text-center space-y-4 border">
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
