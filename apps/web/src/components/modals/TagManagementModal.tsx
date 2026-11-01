import { useTranslations } from "@teak/i18n/react";
import { useEffect, useRef } from "react";
import { Plus, Sparkles, X } from "vadivam-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isImeComposing } from "@/lib/keyboardShortcuts";

const TAG_CHIP_CLASS =
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-l-full border border-r-0 bg-background px-3 font-medium text-sm has-[>svg]:px-2.5 dark:border-input dark:bg-input/30 [&_svg]:size-4 [&_svg]:shrink-0";

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
  const t = useTranslations("modals.tagManagement");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isImeComposing(e)) {
      return;
    }
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
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="new-tag">{t("addLabel")}</Label>
            <div className="mt-2 flex gap-2">
              <Input
                className="flex-1"
                id="new-tag"
                maxLength={100}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("placeholder")}
                ref={inputRef}
                value={tagInput}
              />
              <Button
                aria-label={t("addTag")}
                disabled={!tagInput.trim()}
                onClick={onAddTag}
                size="icon"
              >
                <Plus />
              </Button>
            </div>
          </div>

          {userTags.length > 0 && (
            <div>
              <Label>{t("yourTags")}</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {userTags.map((tag) => (
                  <div className="inline-flex" key={tag}>
                    <span className={TAG_CHIP_CLASS}>{tag}</span>
                    <Button
                      aria-label={t("removeUserTag", { tag })}
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

          {aiTags.length > 0 && (
            <div>
              <Label>{t("teakTags")}</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {aiTags.map((tag) => (
                  <div className="inline-flex" key={`ai-${tag}`}>
                    <span className={TAG_CHIP_CLASS}>
                      <Sparkles />
                      {tag}
                    </span>
                    <Button
                      aria-label={t("removeTeakTag", { tag })}
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

          {userTags.length === 0 && aiTags.length === 0 && (
            <div className="py-4 text-center text-muted-foreground">
              <p>{t("empty")}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
