import { Button } from "@teak/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { Input } from "@teak/ui/components/ui/input";
import { Label } from "@teak/ui/components/ui/label";
import { Plus, Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";

interface TagManagementModalProps {
  aiTags: string[];
  onAddTag: () => void;
  onOpenChange: (open: boolean) => void;
  onRemoveAiTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  open: boolean;
  setTagInput: (value: string) => void;
  tagInput: string;
  userTags: string[];
}

export function TagManagementModal({
  open,
  onOpenChange,
  userTags,
  aiTags,
  tagInput,
  setTagInput,
  onAddTag,
  onRemoveTag,
  onRemoveAiTag,
}: TagManagementModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      onAddTag();
    } else if (e.key === "Escape") {
      onOpenChange(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Add New Tag */}
          <div>
            <Label htmlFor="new-tag">Add New Tag</Label>
            <div className="mt-2 flex gap-2">
              <Input
                className="flex-1"
                id="new-tag"
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter tag name"
                ref={inputRef}
                value={tagInput}
              />
              <Button
                disabled={!tagInput.trim()}
                onClick={onAddTag}
                size="icon"
              >
                <Plus />
              </Button>
            </div>
          </div>

          {/* User Tags */}
          {userTags && userTags.length > 0 && (
            <div>
              <Label>Your Tags</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {userTags.map((tag) => (
                  <div className="inline-flex" key={tag}>
                    <Button
                      className="rounded-r-none border-r-0"
                      size="sm"
                      variant="outline"
                    >
                      {tag}
                    </Button>
                    <Button
                      className="rounded-l-none"
                      onClick={() => onRemoveTag(tag)}
                      size="sm"
                      variant="outline"
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Tags */}
          {aiTags && aiTags.length > 0 && (
            <div>
              <Label>Tags by Teak</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {aiTags.map((tag) => (
                  <div className="inline-flex" key={`ai-${tag}`}>
                    <Button
                      className="rounded-r-none border-r-0"
                      size="sm"
                      variant="outline"
                    >
                      <Sparkles />
                      {tag}
                    </Button>
                    <Button
                      className="rounded-l-none"
                      onClick={() => onRemoveAiTag(tag)}
                      size="sm"
                      variant="outline"
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {(!userTags || userTags.length === 0) &&
            (!aiTags || aiTags.length === 0) && (
              <div className="py-4 text-center text-muted-foreground">
                <p>No tags yet. Add your first tag above!</p>
              </div>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
