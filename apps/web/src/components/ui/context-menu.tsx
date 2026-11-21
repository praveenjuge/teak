import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type * as React from "react";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "vadivam-react";

import {
  ignoreMenuOpeningRelease,
  markContextMenuOpened,
} from "../../lib/contextMenuRelease";
import { cn } from "../../lib/utils";

type WithClassName<Props> = Omit<Props, "className"> & { className?: string };

type PositionerProps = Pick<
  ContextMenuPrimitive.Positioner.Props,
  "align" | "alignOffset" | "collisionPadding" | "side" | "sideOffset"
>;

const MENU_POPUP_CLASS =
  "data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-y-auto overflow-x-hidden rounded-xl border bg-popover p-1 text-popover-foreground outline-none data-closed:animate-out data-closed:fill-mode-forwards data-open:animate-in";

const MENU_ITEM_CLASS =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm text-sm outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";

function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({
  onContextMenu,
  ...props
}: ContextMenuPrimitive.Trigger.Props) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      onContextMenu={(event) => {
        onContextMenu?.(event);
        if (!event.defaultPrevented) {
          markContextMenuOpened();
        }
      }}
      {...props}
    />
  );
}

function ContextMenuGroup({ ...props }: ContextMenuPrimitive.Group.Props) {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  );
}

function ContextMenuPortal({ ...props }: ContextMenuPrimitive.Portal.Props) {
  return (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
  );
}

function ContextMenuSub({ ...props }: ContextMenuPrimitive.SubmenuRoot.Props) {
  return (
    <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />
  );
}

function ContextMenuRadioGroup({
  ...props
}: ContextMenuPrimitive.RadioGroup.Props) {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  );
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: WithClassName<ContextMenuPrimitive.SubmenuTrigger.Props> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      className={cn(
        MENU_ITEM_CLASS,
        "px-2 py-1.5 data-popup-open:bg-accent data-[inset]:pl-8 data-popup-open:text-accent-foreground",
        className
      )}
      data-inset={inset}
      data-slot="context-menu-sub-trigger"
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </ContextMenuPrimitive.SubmenuTrigger>
  );
}

// Left unset, side and align fall back to Base UI's defaults, which place a
// submenu beside its trigger.
function ContextMenuPopup({
  align,
  alignOffset,
  className,
  collisionPadding,
  side,
  sideOffset,
  ...props
}: WithClassName<ContextMenuPrimitive.Popup.Props> & PositionerProps) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="z-50 outline-none"
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
      >
        <ContextMenuPrimitive.Popup
          className={cn(MENU_POPUP_CLASS, className)}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPopup>) {
  return (
    <ContextMenuPopup
      className={cn("shadow-lg", className)}
      data-slot="context-menu-sub-content"
      {...props}
    />
  );
}

// Opens to the right of the pointer, top-aligned, as Radix's did.
function ContextMenuContent({
  align = "start",
  alignOffset = 0,
  className,
  side = "right",
  sideOffset = 2,
  ...props
}: React.ComponentProps<typeof ContextMenuPopup>) {
  return (
    <ContextMenuPopup
      align={align}
      alignOffset={alignOffset}
      className={cn("shadow-md", className)}
      data-slot="context-menu-content"
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  );
}

function ContextMenuItem({
  className,
  inset,
  onMouseUp,
  variant = "default",
  ...props
}: WithClassName<ContextMenuPrimitive.Item.Props> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        MENU_ITEM_CLASS,
        "data-[variant=destructive]:*:[svg]:!text-destructive px-2 py-1.5 data-[variant=destructive]:data-highlighted:bg-destructive/10 data-[variant=destructive]:data-highlighted:text-destructive data-[inset]:pl-8 data-[variant=destructive]:text-destructive dark:data-[variant=destructive]:data-highlighted:bg-destructive/20 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      data-inset={inset}
      data-slot="context-menu-item"
      data-variant={variant}
      onMouseUp={(event) => {
        onMouseUp?.(event);
        ignoreMenuOpeningRelease(event);
      }}
      {...props}
    />
  );
}

// Closes the menu once picked, as Radix did; pass closeOnClick={false} to
// keep it open.
function ContextMenuCheckboxItem({
  className,
  closeOnClick = true,
  children,
  onMouseUp,
  ...props
}: WithClassName<ContextMenuPrimitive.CheckboxItem.Props>) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      className={cn(MENU_ITEM_CLASS, "py-1.5 pr-2 pl-8", className)}
      closeOnClick={closeOnClick}
      data-slot="context-menu-checkbox-item"
      onMouseUp={(event) => {
        onMouseUp?.(event);
        ignoreMenuOpeningRelease(event);
      }}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <ContextMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </ContextMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

// Closes the menu once picked, as Radix did.
function ContextMenuRadioItem({
  className,
  closeOnClick = true,
  children,
  onMouseUp,
  ...props
}: WithClassName<ContextMenuPrimitive.RadioItem.Props>) {
  return (
    <ContextMenuPrimitive.RadioItem
      className={cn(MENU_ITEM_CLASS, "py-1.5 pr-2 pl-8", className)}
      closeOnClick={closeOnClick}
      data-slot="context-menu-radio-item"
      onMouseUp={(event) => {
        onMouseUp?.(event);
        ignoreMenuOpeningRelease(event);
      }}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <ContextMenuPrimitive.RadioItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </ContextMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

// A plain caption: Base UI's GroupLabel only works inside a Group.
function ContextMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<"div"> & {
  inset?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-2 py-1.5 font-medium text-foreground text-sm data-[inset]:pl-8",
        className
      )}
      data-inset={inset}
      data-slot="context-menu-label"
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: WithClassName<ContextMenuPrimitive.Separator.Props>) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      data-slot="context-menu-separator"
      {...props}
    />
  );
}

function ContextMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "ml-auto text-muted-foreground text-xs tracking-widest",
        className
      )}
      data-slot="context-menu-shortcut"
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
};
