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
      onCancel={props.onCancel}
      open={props.open}
      type={props.card?.type}
    />
  )
);

export const preloadCardModal = LazyConnectedCardModal.preload;

function CardModalLoading({
  onCancel,
  open,
  type,
}: {
  onCancel?: () => void;
  open: boolean;
  type?: string;
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
        className={cardModalFrameClass(type)}
        overlayClassName={CARD_MODAL_OVERLAY_CLASS}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t("openingCard")}</DialogTitle>
        <CardModalSkeleton />
      </DialogContent>
    </Dialog>
  );
}
