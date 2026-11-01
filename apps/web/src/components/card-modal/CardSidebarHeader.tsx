import type { ComponentProps, ReactNode, RefObject } from "react";
import { useEffect, useState } from "react";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ariaKeyShortcut, isImeComposing } from "../../lib/keyboardShortcuts";
import { cn } from "../../lib/utils";
import { SiteFavicon } from "../cards/SiteFavicon";
import { ShortcutTooltip } from "../shortcuts/ShortcutTooltip";

export const SIDEBAR_PRIMARY_CLASS =
  "h-9 w-full rounded-full bg-foreground text-background hover:bg-foreground/85";

export const SIDEBAR_PRIMARY_COMPACT_CLASS =
  "h-8 rounded-full bg-foreground px-3.5 text-background hover:bg-foreground/85";

export function ActionCell({
  caption,
  children,
  className,
  label,
  pressed,
  shortcut,
  tone,
  ref,
  ...props
}: ComponentProps<"button"> & {
  caption: string;
  children: ReactNode;
  label: string;
  pressed?: boolean;
  shortcut?: readonly string[];
  tone?: "primary";
}) {
  return (
    <ShortcutTooltip keys={shortcut} label={label}>
      <button
        aria-keyshortcuts={shortcut ? ariaKeyShortcut(shortcut) : undefined}
        aria-label={label}
        aria-pressed={pressed}
        className={cn(
          "flex h-13 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35 data-[state=open]:bg-muted data-[state=open]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
          pressed && tone === "primary" && "text-primary hover:text-primary",
          className
        )}
        ref={ref}
        type="button"
        {...props}
      >
        {children}
        <span aria-hidden="true" className="max-w-full truncate text-[11px]">
          {caption}
        </span>
      </button>
    </ShortcutTooltip>
  );
}

/**
 * True once `target` has scrolled out of the top of `root`: the sidebar
 * then pins a one-line copy of its actions. `target` is the element itself
 * (from a callback ref), so observing starts whenever it mounts, such as
 * when a card finishes loading.
 */
export function useScrolledPast(
  root: RefObject<HTMLElement | null>,
  target: HTMLElement | null
): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    setPast(false);
    const rootElement = root.current;
    if (
      !(rootElement && target) ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) {
          return;
        }
        const top = entry.rootBounds?.top ?? 0;
        setPast(
          !entry.isIntersecting && entry.boundingClientRect.bottom <= top + 1
        );
      },
      { root: rootElement, threshold: 0 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [root, target]);
  return past;
}

interface SidebarTitleProps {
  added?: string;
  editable: boolean;
  hostname?: string;
  label: string;
  onCommit: () => void;
  onTitleChange: (value: string | undefined) => void;
  onTypeClick?: () => void;
  placeholder: string;
  saveStatus?: { error: boolean; label: string } | null;
  showTitle: boolean;
  title: string;
  titleValue: string;
  typeIcon: ReactNode;
  typeLabel: string;
  typeTitle: string;
}

export function SidebarTitle({
  added,
  editable,
  hostname,
  label,
  onCommit,
  onTitleChange,
  onTypeClick,
  placeholder,
  saveStatus,
  showTitle,
  title,
  titleValue,
  typeIcon,
  typeLabel,
  typeTitle,
}: SidebarTitleProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-5 min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
        {hostname ? (
          <>
            <SiteFavicon className="size-3.5" hostname={hostname} />
            <span className="min-w-0 truncate" dir="auto">
              {hostname}
            </span>
            <span aria-hidden="true">·</span>
          </>
        ) : null}
        <button
          className="-mx-1 inline-flex h-5 shrink-0 items-center gap-1 rounded px-1 hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
          disabled={!onTypeClick}
          onClick={onTypeClick}
          title={typeTitle}
          type="button"
        >
          {typeIcon}
          {typeLabel}
        </button>
        {!showTitle && added ? (
          <>
            <span aria-hidden="true">·</span>
            <DialogDescription asChild className="text-xs">
              <span className="truncate">{added}</span>
            </DialogDescription>
          </>
        ) : null}
        {saveStatus ? (
          <span
            className={cn(
              "ml-auto shrink-0 whitespace-nowrap pl-2",
              saveStatus.error && "text-destructive"
            )}
          >
            {saveStatus.label}
          </span>
        ) : null}
      </div>

      {editable ? (
        <div className="group/title relative">
          {/* Names the dialog; hidden from reading so the title isn't heard
              twice, as this heading and as the "Title" field below. */}
          <DialogTitle aria-hidden="true" className="sr-only">
            {title}
          </DialogTitle>
          <textarea
            aria-label={label}
            className="field-sizing-content -mx-1.5 block max-h-[calc(3lh+0.5rem)] w-[calc(100%+0.75rem)] resize-none overflow-hidden rounded-md bg-transparent px-1.5 py-1 font-semibold text-base leading-snug outline-none transition-colors placeholder:text-muted-foreground/60 hover:bg-muted/70 focus-visible:max-h-48 focus-visible:overflow-y-auto focus-visible:bg-muted/70"
            dir="auto"
            maxLength={512}
            onBlur={(event) => {
              event.currentTarget.scrollTop = 0;
              if (event.target.value.trim()) {
                onCommit();
              } else {
                onTitleChange(undefined);
              }
            }}
            onChange={(event) =>
              onTitleChange(event.target.value.replace(/\s*\n\s*/g, " "))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isImeComposing(event)) {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            placeholder={placeholder}
            rows={1}
            value={titleValue}
          />
        </div>
      ) : (
        <DialogTitle
          className={cn(
            "line-clamp-3 break-words font-semibold text-base leading-snug",
            !showTitle && "sr-only"
          )}
          dir="auto"
          title={title}
        >
          {title}
        </DialogTitle>
      )}
    </div>
  );
}
