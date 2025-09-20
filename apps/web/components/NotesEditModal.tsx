import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Save } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface NotesEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notes: string;
  onSave: (notes: string) => void;
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

  const handleSave = () => {
    onSave(localNotes);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setLocalNotes(notes); // Reset to original value
    onCancel();
    onOpenChange(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      handleSave();
    }
  };

  const hasChanges = localNotes !== notes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{notes ? "Edit Notes" : "Add Notes"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Textarea
            ref={textareaRef}
            id="notes-textarea"
            value={localNotes}
            onChange={(e) => setLocalNotes(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add your notes here..."
            className="mt-1 min-h-[120px]"
            rows={6}
          />
          <div className="text-xs text-muted-foreground">
            Press{" "}
            <kbd className="px-1 py-0.5 text-xs font-mono bg-muted rounded">
              Cmd+Enter
            </kbd>{" "}
            to save,
            <kbd className="px-1 py-0.5 text-xs font-mono bg-muted rounded ml-1">
              Esc
            </kbd>{" "}
            to cancel
          </div>
        </div>

        <DialogFooter className="md:justify-between">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges && !!notes}>
            <Save />
            {notes ? "Update" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
