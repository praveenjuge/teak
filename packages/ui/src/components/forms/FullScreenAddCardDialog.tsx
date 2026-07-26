import { Button } from "@teak/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { MarkdownTextEditor } from "@teak/ui/text-editor";
import { toast } from "sonner";

interface FullScreenAddCardDialogProps {
  canCreateCard: boolean;
  content: string;
  isSubmitting: boolean;
  onContentChange: (value: string) => void;
  onRequestClose: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  open: boolean;
  placeholder: string;
}

export function FullScreenAddCardDialog({
  open,
  content,
  canCreateCard,
  isSubmitting,
  placeholder,
  onContentChange,
  onSave,
  onRequestClose,
}: FullScreenAddCardDialogProps) {
  const canSave = Boolean(content.trim() && canCreateCard && !isSubmitting);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          void onRequestClose();
        }
      }}
      open={open}
    >
      <DialogContent
        className="fixed top-0 left-0 h-dvh w-dvw max-w-none translate-x-0! translate-y-0! transform-none overscroll-contain rounded-none! border-0 p-0 shadow-none sm:max-w-none"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Full-screen note</DialogTitle>
        <DialogDescription className="sr-only">
          Add a new note in full-screen mode
        </DialogDescription>

        <div className="flex h-dvh w-full flex-col">
          <div className="z-20 flex items-center justify-between border-b bg-background/90 px-4 py-2 backdrop-blur sm:px-6">
            <Button
              onClick={() => void onRequestClose()}
              size="sm"
              type="button"
              variant="outline"
            >
              Close
            </Button>
            <Button
              disabled={!canSave}
              onClick={() => void onSave()}
              size="sm"
              type="button"
            >
              Save
            </Button>
          </div>

          <MarkdownTextEditor
            ariaLabel="Markdown content"
            autoFocus
            className="mx-auto h-full w-full max-w-3xl overflow-y-auto px-4 py-6 sm:px-7 sm:py-8"
            disabled={!canCreateCard}
            minHeight="60vh"
            onChange={onContentChange}
            onLimitExceeded={() =>
              toast.error("Notes can be up to 512 KiB of UTF-8 text")
            }
            onSaveShortcut={() => {
              if (canSave) {
                void onSave();
              }
            }}
            placeholder={placeholder}
            value={content}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
