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

/**
 * `ConnectedCardModal`, loaded on demand. It mounts the first time a card
 * opens and stays mounted after, so later opens and closes behave as before.
 * Opened before its code arrives, it shows the same dialog frame at once and
 * fills in when the code lands. Text cards open in the rich editor, so the
 * editor loads with it: the dialog never shows the editor's plain stand-in.
 */
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

/**
 * Starts loading the card dialog. The grid calls it once cards are on
 * screen and again when someone points at or presses a card, so a quick
 * click finds it ready.
 */
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
