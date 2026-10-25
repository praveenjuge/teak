"use client";

import { api } from "@teak/convex";
import type { Id } from "@teak/convex/_generated/dataModel";
import { isSafeExternalUrl } from "@teak/convex/shared/utils/safeUrl";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useId, useState } from "react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { useServerErrors } from "@/hooks/useServerErrors";
import { useSingleFlight } from "../../hooks/useSingleFlight";

export interface EditLinkTarget {
  id: string;
  url: string;
}

/**
 * The address to save, or null when it isn't an http or https link: the
 * server refuses those too.
 */
export const editedLinkUrl = (value: string): string | null => {
  const trimmed = value.trim();
  return isSafeExternalUrl(trimmed) ? trimmed : null;
};

interface EditLinkDialogProps {
  card: EditLinkTarget | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function EditLinkDialog({
  card,
  onOpenChange,
  open,
}: EditLinkDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md">
        {card ? (
          <EditLinkForm
            card={card}
            key={card.id}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditLinkForm({
  card,
  onDone,
}: {
  card: EditLinkTarget;
  onDone: () => void;
}) {
  const t = useTranslations("cards.editLink");
  const tc = useTranslations("common");
  const errors = useServerErrors();
  const inputId = useId();
  const updateCardField = useMutation(api.cards.updateCardField);
  const [value, setValue] = useState(card.url);
  const [error, setError] = useState<string | null>(null);

  const [save, isSaving] = useSingleFlight(async () => {
    const url = editedLinkUrl(value);
    if (!url) {
      setError(t("invalid"));
      return;
    }
    if (url === card.url) {
      onDone();
      return;
    }
    try {
      await updateCardField({
        cardId: card.id as Id<"cards">,
        field: "url",
        value: url,
      });
      toast.success(t("saved"));
      onDone();
    } catch (saveError) {
      setError(errors.message(saveError, t("failed")));
    }
  });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          save().catch(() => undefined);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor={inputId}>{t("label")}</Label>
          <Input
            aria-describedby={error ? `${inputId}-error` : undefined}
            aria-invalid={error ? true : undefined}
            autoCapitalize="off"
            autoComplete="url"
            autoCorrect="off"
            autoFocus
            dir="ltr"
            id={inputId}
            inputMode="url"
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            spellCheck={false}
            type="url"
            value={value}
          />
          {error ? (
            <p
              className="text-destructive text-sm"
              id={`${inputId}-error`}
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button onClick={onDone} type="button" variant="outline">
            {tc("cancel")}
          </Button>
          <Button disabled={isSaving || !value.trim()} type="submit">
            {isSaving ? tc("saving") : tc("save")}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
