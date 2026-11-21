import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import type * as React from "react";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "vadivam-react";

import { cn } from "../../lib/utils";

type WithClassName<Props> = Omit<Props, "className"> & { className?: string };

type PositionerProps = Pick<
  MenuPrimitive.Positioner.Props,
  "align" | "alignOffset" | "collisionPadding" | "side" | "sideOffset"
>;

const MENU_POPUP_CLASS =
  "data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-y-auto overflow-x-hidden rounded-xl border bg-popover p-1 text-popover-foreground outline-none data-closed:animate-out data-closed:fill-mode-forwards data-open:animate-in";

const MENU_ITEM_CLASS =
  "relative flex cursor-default select-none items-center gap-2 text-sm outline-hidden data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  align = "center",
  alignOffset,
  className,
  collisionPadding,
  side = "bottom",
  sideOffset = 4,
  ...props
}: WithClassName<MenuPrimitive.Popup.Props> & PositionerProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="z-50 outline-none"
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn(MENU_POPUP_CLASS, "shadow-md", className)}
          data-slot="dropdown-menu-content"
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: WithClassName<MenuPrimitive.Item.Props> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <MenuPrimitive.Item
      className={cn(
        MENU_ITEM_CLASS,
        "data-[variant=destructive]:*:[svg]:!text-destructive rounded-md px-2 py-1.5 data-[variant=destructive]:data-highlighted:bg-destructive/10 data-[variant=destructive]:data-highlighted:text-destructive data-[inset]:pl-8 data-[variant=destructive]:text-destructive dark:data-[variant=destructive]:data-highlighted:bg-destructive/20 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      data-inset={inset}
      data-slot="dropdown-menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

// Closes the menu once picked, as Radix did; pass closeOnClick={false} to
// keep it open.
function DropdownMenuCheckboxItem({
  className,
  closeOnClick = true,
  children,
  ...props
}: WithClassName<MenuPrimitive.CheckboxItem.Props>) {
  return (
    <MenuPrimitive.CheckboxItem
      className={cn(MENU_ITEM_CLASS, "rounded-sm py-1.5 pr-2 pl-8", className)}
      closeOnClick={closeOnClick}
      data-slot="dropdown-menu-checkbox-item"
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  );
}

// Closes the menu once picked, as Radix did.
function DropdownMenuRadioItem({
  className,
  closeOnClick = true,
  children,
  ...props
}: WithClassName<MenuPrimitive.RadioItem.Props>) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(MENU_ITEM_CLASS, "rounded-sm py-1.5 pr-2 pl-8", className)}
      closeOnClick={closeOnClick}
      data-slot="dropdown-menu-radio-item"
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

// A plain caption: Base UI's GroupLabel only works inside a Group, and these
// head loose items as often as groups.
function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<"div"> & {
  inset?: boolean;
}) {
  return (
    <div
      className={cn(
        "px-2 py-1.5 font-medium text-sm data-[inset]:pl-8",
        className
      )}
      data-inset={inset}
      data-slot="dropdown-menu-label"
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: WithClassName<MenuPrimitive.Separator.Props>) {
  return (
    <MenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      data-slot="dropdown-menu-separator"
      {...props}
    />
  );
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "ml-auto text-muted-foreground text-xs tracking-widest",
        className
      )}
      data-slot="dropdown-menu-shortcut"
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: WithClassName<MenuPrimitive.SubmenuTrigger.Props> & {
  inset?: boolean;
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(
        MENU_ITEM_CLASS,
        "rounded-sm px-2 py-1.5 data-popup-open:bg-accent data-[inset]:pl-8 data-popup-open:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground",
        className
      )}
      data-inset={inset}
      data-slot="dropdown-menu-sub-trigger"
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

// Base UI places submenus beside their trigger when side and align are left
// unset, flipping them to fit.
function DropdownMenuSubContent({
  align,
  alignOffset,
  className,
  collisionPadding,
  side,
  sideOffset,
  ...props
}: WithClassName<MenuPrimitive.Popup.Props> & PositionerProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="z-50 outline-none"
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn(MENU_POPUP_CLASS, "shadow-lg", className)}
          data-slot="dropdown-menu-sub-content"
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
