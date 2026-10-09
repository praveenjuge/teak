"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { type LucideIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../ui/dialog";

type SettingsDialogTone = "default" | "destructive";

interface SettingsDialogProps {
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  footer?: ReactNode;
  icon: LucideIcon;
  onOpenAutoFocus?: (event: Event) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
  tone?: SettingsDialogTone;
}

export function SettingsIconTile({
  icon: Icon,
  tone = "default",
  className,
}: {
  className?: string;
  icon: LucideIcon;
  tone?: SettingsDialogTone;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-xl border bg-background shadow-xs",
        tone === "destructive"
          ? "border-destructive/20 bg-destructive/5 text-destructive"
          : "text-muted-foreground",
        className
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/**
 * Shared frame for every settings dialog: a featured icon, title and
 * supporting text, a close button inside the panel, a body and an optional
 * footer of equal-width actions.
 */
export function SettingsDialog({
  children,
  className,
  description,
  footer,
  icon,
  onOpenAutoFocus,
  onOpenChange,
  open,
  title,
  tone = "default",
}: SettingsDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn(
          "flex max-h-[min(88dvh,44rem)] flex-col gap-0 overflow-hidden p-0 shadow-2xl outline-none sm:max-w-md",
          className
        )}
        onOpenAutoFocus={onOpenAutoFocus}
        overlayClassName="bg-black/40 backdrop-blur-[2px] dark:bg-black/70"
        showCloseButton={false}
      >
        <div className="shrink-0 px-6 pt-6 pb-5">
          <SettingsIconTile className="size-10" icon={icon} tone={tone} />
          <div className="mt-4 space-y-1 pr-8">
            <DialogTitle className="font-semibold text-base leading-6">
              {title}
            </DialogTitle>
            {description ? (
              <DialogDescription className="leading-5">
                {description}
              </DialogDescription>
            ) : null}
          </div>
        </div>
        {children}
        {footer ? (
          <div className="flex shrink-0 gap-3 px-6 pt-1 pb-6 *:flex-1">
            {footer}
          </div>
        ) : null}
        {/* Last in the DOM so initial focus lands on the dialog's own content. */}
        <DialogPrimitive.Close className="absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsDialogBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 pb-6", className)}>
      {children}
    </div>
  );
}

// Underline tabs that sit flush under the dialog header; panels scroll on
// their own so the header and tab bar stay put.
export const settingsTabsClassName = "min-h-0 flex-1 gap-0";
export const settingsTabsListClassName =
  "h-auto w-full shrink-0 justify-start gap-5 rounded-none border-b bg-transparent p-0 px-6 dark:bg-transparent";
export const settingsTabsTriggerClassName =
  "-mb-px h-auto flex-none rounded-none border-0 border-transparent border-b-2 px-0.5 pt-0 pb-2.5 text-muted-foreground shadow-none hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:text-muted-foreground dark:data-[state=active]:border-foreground dark:data-[state=active]:bg-transparent";
export const settingsTabsContentClassName =
  "min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pt-5 pb-6";

export function SettingsList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y rounded-xl border", className)}>{children}</ul>
  );
}

const SKELETON_ROW_KEYS = ["first", "second", "third"];

export function SettingsListSkeleton({
  label,
  rows = 2,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="divide-y rounded-xl border">
        {SKELETON_ROW_KEYS.slice(0, rows).map((key) => (
          <div className="flex items-center gap-3 px-4 py-3" key={key}>
            <span className="size-9 shrink-0 animate-pulse rounded-xl bg-muted" />
            <span className="flex-1 space-y-2">
              <span className="block h-3 w-2/5 animate-pulse rounded-full bg-muted" />
              <span className="block h-3 w-1/4 animate-pulse rounded-full bg-muted" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsEmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
      {children}
    </p>
  );
}
