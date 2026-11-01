import { TRASH_RETENTION_MS } from "@teak/convex/shared/constants";
import { useTranslations } from "@teak/i18n/react";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days a card stays in Trash before Teak's cleanup deletes it forever. */
export const TRASH_RETENTION_DAYS = Math.round(TRASH_RETENTION_MS / DAY_MS);

/** The line at the top of Trash that says how long cards stay there. */
export function TrashRetentionNote() {
  const t = useTranslations("cards.trash");
  return (
    <p className="mb-4 text-muted-foreground text-sm">
      {t("retention", { days: TRASH_RETENTION_DAYS })}
    </p>
  );
}
