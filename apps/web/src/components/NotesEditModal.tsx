import { Button } from "@teak/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { Spinner } from "@teak/ui/components/ui/spinner";
import { Textarea } from "@teak/ui/components/ui/textarea";
import { useEffect, useRef, useState } from "react";

interface NotesEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: string;
  onSave: (notes: string) => Promise<boolean>;
  onCancel: () => void;
}

export function NotesEditModal({
  open,
  onOpenChange,
  notes,
  onSave,
  onCancel,
}: NotesEditModalProps) {
  const [localNotes, setLocalNotes] = useState(notes);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLocalNotes(notes);
  }, [notes]);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
      // Place cursor at end of text
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [open]);

  const handleSave = async () => {
    if (isSaving) {
      return;
    }

    if (localNotes === notes) {
      onOpenChange(false);
      return;
    }

    setIsSaving(true);
    try {
      const didSave = await onSave(localNotes);
      if (didSave) {
        onOpenChange(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (isSaving) {
      return;
    }
    setLocalNotes(notes); // Reset to original value
    onCancel();
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      void handleSave();
    }
  };

  const hasChanges = localNotes !== notes;

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!isSaving) {
          onOpenChange(nextOpen);
        }
      }}
      open={open}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Notes</DialogTitle>
          <DialogDescription>
            Press{" "}
            <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              Cmd+Enter
            </kbd>{" "}
            to save,
            <kbd className="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
              Esc
            </kbd>{" "}
            to cancel
          </DialogDescription>
        </DialogHeader>

        <Textarea
          className="mt-1 min-h-30"
          id="notes-textarea"
          onChange={(e) => setLocalNotes(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add your notes here..."
          ref={textareaRef}
          rows={6}
          value={localNotes}
        />

        <DialogFooter className="md:justify-between">
          <Button disabled={isSaving} onClick={handleCancel} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={isSaving || (!hasChanges && !!notes)}
            onClick={() => {
              void handleSave();
            }}
          >
            {isSaving ? <Spinner /> : notes ? "Update" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
