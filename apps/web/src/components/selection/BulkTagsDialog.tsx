import { MAX_TAG_NAME_LENGTH } from "@teak/convex/shared/tags";
import { useTranslations } from "@teak/i18n/react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const MAX_TAGS = 20;

export const parseTagInput = (value: string): string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of value.split(",")) {
    const tag = raw.trim();
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
    }
  }
  return tags;
};

interface BulkTagsDialogProps {
  mode: "add" | "remove";
  onOpenChange: (open: boolean) => void;
  onSubmit: (tags: string[]) => void;
  open: boolean;
  selectedCount: number;
  suggestions?: string[];
}

export function BulkTagsDialog({
  mode,
  open,
  onOpenChange,
  onSubmit,
  selectedCount,
  suggestions = [],
}: BulkTagsDialogProps) {
  const t = useTranslations("selection.tagsDialog");
  const tc = useTranslations("common");
  const inputId = useId();
  const [input, setInput] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setInput("");
      setPicked([]);
    }
  }, [open]);

  const tags = parseTagInput([...picked, input].join(","));
  const tooLong = tags.find((tag) => tag.length > MAX_TAG_NAME_LENGTH);
  let problem: string | null = null;
  if (tooLong) {
    problem = t("tagTooLong", { max: MAX_TAG_NAME_LENGTH });
  } else if (tags.length > MAX_TAGS) {
    problem = t("tooManyTags", { max: MAX_TAGS });
  }
  const canSubmit = tags.length > 0 && !problem;

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    onOpenChange(false);
    onSubmit(tags);
  };

  const togglePicked = (tag: string) =>
    setPicked((previous) =>
      previous.includes(tag)
        ? previous.filter((item) => item !== tag)
        : [...previous, tag]
    );

  const isAdd = mode === "add";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isAdd
              ? t("addTitle", { count: selectedCount })
              : t("removeTitle", { count: selectedCount })}
          </DialogTitle>
          <DialogDescription>
            {isAdd ? t("addDescription") : t("removeDescription")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {!isAdd && suggestions.length > 0 && (
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {suggestions.map((tag) => (
                <Button
                  aria-pressed={picked.includes(tag)}
                  className="max-w-full justify-start"
                  key={tag}
                  onClick={() => togglePicked(tag)}
                  size="sm"
                  title={tag}
                  type="button"
                  variant={picked.includes(tag) ? "default" : "outline"}
                >
                  <span className="truncate">{tag}</span>
                </Button>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <label className="sr-only" htmlFor={inputId}>
              {t("label")}
            </label>
            <Input
              autoFocus
              id={inputId}
              onChange={(event) => setInput(event.target.value)}
              placeholder={isAdd ? t("addPlaceholder") : t("removePlaceholder")}
              value={input}
            />
            {problem ? (
              <p className="text-destructive text-sm" role="alert">
                {problem}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {tc("cancel")}
            </Button>
            <Button disabled={!canSubmit} type="submit">
              {isAdd ? t("addSubmit") : t("removeSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
