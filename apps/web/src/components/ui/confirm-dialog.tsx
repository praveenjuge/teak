"use client";

import type { ReactNode } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel: string;
  description: ReactNode;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="sm:max-w-md"
        role="alertdialog"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {cancelLabel}
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
            variant="destructive"
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
