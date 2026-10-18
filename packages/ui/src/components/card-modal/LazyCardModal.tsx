"use client";

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@teak/ui/components/ui/dialog";
import { Skeleton } from "@teak/ui/components/ui/skeleton";
import { Spinner } from "@teak/ui/components/ui/spinner";
import { onDemand } from "../../lib/lazyWithPreload";
import { preloadMarkdownTextEditor } from "../text-editor/MarkdownTextEditor";
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
        <DialogTitle className="sr-only">Opening card</DialogTitle>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b pr-3 pl-4">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-4 w-48" />
        </header>
        <div className="grid flex-1 place-items-center">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
