"use client";

import { api } from "@teak/convex";
import { TRASH_COUNT_LIMIT } from "@teak/convex/shared/constants";
import { useTranslations } from "@teak/i18n/react";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Trash } from "vadivam-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { registerEmptyTrash } from "@/lib/commandPalette";
import { useQuery } from "@/lib/convexQueryHooks";

const isRateLimited = (error: unknown) =>
  Boolean(
    error &&
      typeof error === "object" &&
      "data" in error &&
      (error as { data?: { code?: unknown } }).data?.code === "RATE_LIMITED"
  );

interface EmptyTrashControlProps {
  /** Cards in Trash, at most `TRASH_COUNT_LIMIT`; undefined while loading. */
  count: number | undefined;
  onEmpty: () => void;
}

/** Trash's Empty Trash button and the confirmation it asks for. */
export function EmptyTrashControl({ count, onEmpty }: EmptyTrashControlProps) {
  const t = useTranslations("cards.emptyTrash");
  const tScreen = useTranslations("screens.cards");
  const [open, setOpen] = useState(false);
  const canEmpty = (count ?? 0) > 0;
  const canEmptyRef = useRef(canEmpty);
  useEffect(() => {
    canEmptyRef.current = canEmpty;
  }, [canEmpty]);
  useEffect(
    () =>
      registerEmptyTrash(() => {
        if (canEmptyRef.current) {
          setOpen(true);
        } else {
          toast(tScreen("emptyTrash"));
        }
      }),
    [tScreen]
  );

  const shown = count ?? 0;
  return (
    <>
      <Button
        className="shrink-0 text-muted-foreground"
        disabled={!canEmpty}
        onClick={() => setOpen(true)}
        size="sm"
        title={t("button")}
        type="button"
        variant="ghost"
      >
        <Trash />
        <span className="max-sm:sr-only">{t("button")}</span>
      </Button>
      <ConfirmDialog
        confirmLabel={t("confirm")}
        description={
          shown >= TRASH_COUNT_LIMIT
            ? t("descriptionAtLeast", { count: shown })
            : t("description", { count: shown })
        }
        onConfirm={onEmpty}
        onOpenChange={setOpen}
        open={open && canEmpty}
        title={t("title")}
      />
    </>
  );
}

export function EmptyTrashButton() {
  const t = useTranslations("cards.emptyTrash");
  const trash = useQuery(api.cards.trashCount, {});
  const emptyTrash = useMutation(api.cards.emptyTrash);

  const empty = async () => {
    try {
      const { count } = await emptyTrash({});
      toast.success(
        count >= TRASH_COUNT_LIMIT ? t("emptyingAll") : t("emptying", { count })
      );
    } catch (error) {
      toast.error(isRateLimited(error) ? t("rateLimited") : t("failed"));
    }
  };

  return (
    <EmptyTrashControl
      count={trash?.count}
      onEmpty={() => {
        empty().catch(() => undefined);
      }}
    />
  );
}
