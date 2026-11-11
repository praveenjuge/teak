import { useTranslations } from "@teak/i18n/react";
import Logo from "../Logo";
import type { AddCardFormProps } from "./AddCardForm";
import { AddCardForm } from "./AddCardForm";

export function AddCardEmptyState({
  autoFocus = true,
  ...addCardFormProps
}: AddCardFormProps) {
  const t = useTranslations("forms.emptyState");
  return (
    <div className="mx-auto flex max-w-xs flex-col items-center gap-5 py-20">
      <Logo variant="current" />
      <AddCardForm autoFocus={autoFocus} {...addCardFormProps} />
      <div className="space-y-1 text-center">
        <h3 className="font-medium">{t("title")}</h3>
        <p className="text-balance text-muted-foreground">{t("description")}</p>
      </div>
    </div>
  );
}
