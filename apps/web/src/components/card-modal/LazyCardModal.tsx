"use client";

import { useTranslations } from "@teak/i18n/react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { onDemand } from "../../lib/lazyWithPreload";
import { preloadMarkdownTextEditor } from "../text-editor/MarkdownTextEditor";
import { CardModalSkeleton } from "./CardModalSkeleton";
import type { ConnectedCardModalProps } from "./ConnectedCardModal";
import {
  CARD_MODAL_OVERLAY_CLASS,
  cardModalFrameClass,
} from "./cardModalFrame";

export const LazyConnectedCardModal = onDemand(
  () =>
    Promise.all([
      import("./ConnectedCardModal"),
      preloadMarkdownTextEditor(),
    ]).then(([module]) => module.ConnectedCardModal),
  (props: ConnectedCardModalProps) => (
    <CardModalLoading
      card={props.card}
      onCancel={props.onCancel}
      open={props.open}
    />
  )
);

export const preloadCardModal = LazyConnectedCardModal.preload;

function CardModalLoading({
  card,
  onCancel,
  open,
}: {
  card?: { content?: string; type?: string } | null;
  onCancel?: () => void;
  open: boolean;
}) {
  const t = useTranslations("cardModal.header");
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel?.();
        }
      }}
      open={open}
    >
      <DialogContent
        aria-busy="true"
        aria-describedby={undefined}
        className={cardModalFrameClass(card)}
        overlayClassName={CARD_MODAL_OVERLAY_CLASS}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("openingCard")}</DialogTitle>
        <CardModalSkeleton />
      </DialogContent>
    </Dialog>
  );
}
