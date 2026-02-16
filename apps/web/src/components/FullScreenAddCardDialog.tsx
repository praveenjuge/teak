import { Alert, AlertDescription } from "@teak/ui/components/ui/alert";
import { Button } from "@teak/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { Textarea } from "@teak/ui/components/ui/textarea";
import { useCallback, useEffect, useRef } from "react";

interface FullScreenAddCardDialogProps {
  open: boolean;
  content: string;
  canCreateCard: boolean;
  isSubmitting: boolean;
  error: string | null;
  placeholder: string;
  onContentChange: (value: string) => void;
  onSave: () => void | Promise<void>;
  onRequestClose: () => void | Promise<void>;
}

export function FullScreenAddCardDialog({
  open,
  content,
  canCreateCard,
  isSubmitting,
  error,
  placeholder,
  onContentChange,
  onSave,
  onRequestClose,
}: FullScreenAddCardDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLLabelElement>(null);

  const resizeTextarea = useCallback((keepBottom = false) => {
    if (!textareaRef.current) {
      return;
    }

    const textarea = textareaRef.current;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;

    if (keepBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusTextarea = () => {
      if (!textareaRef.current) {
        return;
      }
      textareaRef.current.focus();
      const length = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(length, length);
      resizeTextarea(true);
    };

    const frame = requestAnimationFrame(focusTextarea);
    return () => cancelAnimationFrame(frame);
  }, [open, resizeTextarea]);

  const canSave = Boolean(content.trim() && canCreateCard && !isSubmitting);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (canSave) {
        void onSave();
      }
    }
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    const container = scrollContainerRef.current;
    const wasNearBottom = container
      ? container.scrollTop + container.clientHeight >=
        container.scrollHeight - 24
      : false;
    target.style.height = "0px";
    target.style.height = `${target.scrollHeight}px`;
    if (container && wasNearBottom) {
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }
    onContentChange(target.value);
  };

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
        className="!translate-x-0 !translate-y-0 !rounded-none fixed top-0 left-0 h-dvh w-dvw max-w-none transform-none overscroll-contain border-0 p-0 shadow-none sm:max-w-none"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Full-screen note</DialogTitle>
        <DialogDescription className="sr-only">
          Add a new note in full-screen mode
        </DialogDescription>

        <div className="relative h-dvh w-full">
          <div className="fixed top-0 right-0 left-0 z-20 flex items-center justify-between border-b bg-background/90 px-6 py-2 backdrop-blur">
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

          <label
            className="block h-full w-full cursor-text overflow-y-auto"
            htmlFor="fullscreen-content"
            ref={scrollContainerRef}
          >
            <div className="w-full px-6 pt-20 pb-16">
              <div className="mx-auto w-full max-w-3xl">
                <Textarea
                  className="min-h-[60vh] resize-none rounded-none border-0 bg-transparent p-0 text-2xl leading-relaxed shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  disabled={!canCreateCard}
                  id="fullscreen-content"
                  onChange={handleChange}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  ref={textareaRef}
                  value={content}
                />

                {error && (
                  <Alert className="mt-4" variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
