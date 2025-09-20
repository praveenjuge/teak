import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { X, Plus, Sparkles } from "lucide-react";
import { useRef, useEffect } from "react";

interface TagManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userTags: string[];
  aiTags: string[];
  tagInput: string;
  setTagInput: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (tag: string) => void;
  onRemoveAiTag: (tag: string) => void;
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                ref={inputRef}
                id="new-tag"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter tag name"
                className="flex-1"
              />
              <Button
                onClick={onAddTag}
                disabled={!tagInput.trim()}
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
                  <div key={tag} className="inline-flex">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-r-none border-r-0"
                    >
                      {tag}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRemoveTag(tag)}
                      className="rounded-l-none"
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
                  <div key={`ai-${tag}`} className="inline-flex">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-r-none border-r-0"
                    >
                      <Sparkles />
                      {tag}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRemoveAiTag(tag)}
                      className="rounded-l-none"
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
              <div className="text-center text-muted-foreground py-4">
                <p>No tags yet. Add your first tag above!</p>
              </div>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
