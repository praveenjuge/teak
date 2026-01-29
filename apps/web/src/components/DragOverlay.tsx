import { Upload, AlertCircle, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
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

  if (!isDragActive && !isUploading && !showUpgradePrompt) return null;

  const renderDialog = ({
    children,
    modal = true,
  }: {
    children: ReactNode;
    modal?: boolean;
  }) => {
    return (
      <Dialog open modal={modal}>
        <DialogContent showCloseButton={false}>{children}</DialogContent>
      </Dialog>
    );
  };

  // Upgrade prompt state
  if (showUpgradePrompt) {
    return renderDialog({
      children: (
        <>
          <Sparkles />
          <DialogHeader>
            <DialogTitle>Unlock Unlimited Cards</DialogTitle>
            <DialogDescription>
              You&apos;ve reached your free tier limit. Upgrade to Pro for
              unlimited cards.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={navigateToUpgrade}>
              <Sparkles />
              Upgrade to Pro
            </Button>
            <Button onClick={dismissUpgradePrompt} variant="outline">
              Cancel
            </Button>
          </DialogFooter>
        </>
      ),
    });
  }

  // Uploading state
  if (isUploading) {
    return renderDialog({
      children: (
        <>
          <Upload className="text-primary animate-pulse" />
          <DialogHeader>
            <DialogTitle>Uploading file...</DialogTitle>
            <DialogDescription>
              Please wait while we process your file
            </DialogDescription>
          </DialogHeader>
          <Progress value={uploadProgress} className="w-full" />
          <p className="text-muted-foreground">{uploadProgress}% complete</p>
        </>
      ),
    });
  }

  // Drag active state
  const getOverlayContent = () => {
    if (isDragReject) {
      return {
        icon: AlertCircle,
        title: "File type not supported",
        description: "Please drop image, video, audio, or document files",
      };
    }

    return {
      icon: Upload,
      title: "Drop files to create cards",
      description: "Supports images, videos, audio, and documents",
    };
  };

  const { icon: Icon, title, description } = getOverlayContent();

  return renderDialog({
    modal: false,
    children: (
      <>
        <Icon />
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
      </>
    ),
  });
}
