"use client";

import { Slot } from "@radix-ui/react-slot";
import { useTranslations } from "@teak/i18n/react";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { PanelLeftIcon } from "vadivam-react";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useReturnFocus } from "../../hooks/useReturnFocus";
import {
  clampSidebarWidth,
  SIDEBAR_COOKIE_NAME,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_WIDTH_COOKIE_NAME,
} from "../../lib/sidebarState";
import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Separator } from "./separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./sheet";
import { Skeleton } from "./skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const SIDEBAR_WIDTH_MOBILE = "18rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

interface SidebarContextProps {
  isMobile: boolean;
  isResizing: boolean;
  open: boolean;
  openMobile: boolean;
  setOpen: (open: boolean) => void;
  setOpenMobile: (open: boolean) => void;
  setResizing: (resizing: boolean) => void;
  setWidth: (width: number, options?: { persist?: boolean }) => void;
  state: "expanded" | "collapsed";
  toggleSidebar: () => void;
  width: number;
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function useOptionalSidebar() {
  return React.useContext(SidebarContext);
}

function SidebarProvider({
  defaultOpen = true,
  defaultWidth = SIDEBAR_DEFAULT_WIDTH,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  defaultWidth?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);
  const [width, setWidthState] = React.useState(() =>
    clampSidebarWidth(defaultWidth)
  );
  const [isResizing, setResizing] = React.useState(false);
  const setWidth = React.useCallback(
    (value: number, options?: { persist?: boolean }) => {
      const next = clampSidebarWidth(value);
      setWidthState(next);
      if (options?.persist) {
        // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing in older Safari
        document.cookie = `${SIDEBAR_WIDTH_COOKIE_NAME}=${next}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
      }
    },
    []
  );

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--teak-sidebar-width", `${width}px`);
    return () => {
      root.style.removeProperty("--teak-sidebar-width");
    };
  }, [width]);

  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }

      // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API is missing in older Safari
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
    },
    [setOpenProp, open]
  );

  const toggleSidebar = React.useCallback(
    () =>
      isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open),
    [isMobile, setOpen]
  );

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.closest("input, textarea, select, [contenteditable]")
      ) {
        return;
      }
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  const state = open ? "expanded" : "collapsed";

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      isResizing,
      openMobile,
      setOpenMobile,
      setResizing,
      setWidth,
      toggleSidebar,
      width,
    }),
    [
      state,
      open,
      setOpen,
      isMobile,
      isResizing,
      openMobile,
      setWidth,
      toggleSidebar,
      width,
    ]
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          className={cn(
            "group/sidebar-wrapper flex min-h-svh w-full has-data-[variant=inset]:bg-sidebar",
            className
          )}
          data-resizing={isResizing || undefined}
          data-slot="sidebar-wrapper"
          style={
            {
              "--sidebar-width": `${width}px`,
              "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  );
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
}) {
  const t = useTranslations("ui");
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();
  const returnFocus = useReturnFocus(isMobile && openMobile);

  if (collapsible === "none") {
    return (
      <div
        className={cn(
          "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
          className
        )}
        data-slot="sidebar"
        {...props}
      >
        {children}
      </div>
    );
  }

  if (isMobile) {
    return (
      <Sheet onOpenChange={setOpenMobile} open={openMobile} {...props}>
        <SheetContent
          className="w-(--sidebar-width) bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden"
          data-mobile="true"
          data-sidebar="sidebar"
          data-slot="sidebar"
          onCloseAutoFocus={(event) => returnFocus(event)}
          onOpenAutoFocus={(event) => {
            // Start on the current page's link (Radix skips links).
            const current = (
              event.currentTarget as HTMLElement | null
            )?.querySelector<HTMLElement>('[aria-current="page"]');
            if (current) {
              event.preventDefault();
              current.focus();
            }
          }}
          side={side}
          style={
            {
              "--sidebar-width": SIDEBAR_WIDTH_MOBILE,
            } as React.CSSProperties
          }
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{t("menu")}</SheetTitle>
            <SheetDescription>{t("menuDescription")}</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  let gapWidth = "w-(--sidebar-width)";
  if (state === "collapsed") {
    gapWidth = collapsible === "offcanvas" ? "w-0" : "w-(--sidebar-width-icon)";
  }

  return (
    <div
      className="group peer hidden text-sidebar-foreground md:block"
      data-collapsible={state === "collapsed" ? collapsible : ""}
      data-side={side}
      data-slot="sidebar"
      data-state={state}
      data-variant={variant}
    >
      <div
        className={cn(
          "relative bg-transparent transition-[width] duration-150 ease-out group-data-[resizing]/sidebar-wrapper:transition-none",
          "group-data-[side=right]:rotate-180",
          variant === "floating" || variant === "inset"
            ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
            : gapWidth
        )}
        data-slot="sidebar-gap"
      />
      <div
        className={cn(
          "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-150 ease-out group-data-[resizing]/sidebar-wrapper:transition-none md:flex",
          side === "left"
            ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
            : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
          variant === "floating" || variant === "inset"
            ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
            : "group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
          className
        )}
        data-slot="sidebar-container"
        {...props}
      >
        <div
          className="flex h-full w-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm"
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const t = useTranslations("ui");
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      className={cn("size-7", className)}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      size="icon"
      variant="ghost"
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">{t("toggleSidebar")}</span>
    </Button>
  );
}

function SidebarRail({ className, ...props }: React.ComponentProps<"button">) {
  const { setOpen, setResizing, setWidth, state, width } = useSidebar();
  const dragRef = React.useRef<{
    startWidth: number;
    startX: number;
    width: number;
  } | null>(null);
  const isCollapsed = state === "collapsed";
  const t = useTranslations("ui");

  return (
    <button
      aria-label={isCollapsed ? t("expandSidebar") : t("resizeSidebar")}
      className={cn(
        "absolute inset-y-0 z-20 hidden w-3 -translate-x-1/2 touch-none transition-colors ease-out after:absolute after:inset-y-0 after:left-1/2 after:w-px after:transition-colors hover:after:bg-sidebar-border group-data-[side=left]:-right-3 group-data-[side=right]:left-0 sm:flex",
        "in-data-[side=left]:cursor-col-resize in-data-[side=right]:cursor-col-resize",
        "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
        "group-data-[resizing]/sidebar-wrapper:after:bg-sidebar-ring",
        "group-data-[collapsible=offcanvas]:translate-x-0 hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
        className
      )}
      data-sidebar="rail"
      data-slot="sidebar-rail"
      onClick={() => {
        if (isCollapsed) {
          setOpen(true);
        }
      }}
      onDoubleClick={() => {
        if (!isCollapsed) {
          setWidth(SIDEBAR_DEFAULT_WIDTH, { persist: true });
        }
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setResizing(false);
      }}
      onPointerDown={(event) => {
        if (isCollapsed || event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { startWidth: width, startX: event.clientX, width };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) {
          return;
        }
        const delta = event.clientX - drag.startX;
        drag.width = clampSidebarWidth(drag.startWidth + delta);
        setWidth(drag.width);
      }}
      onPointerUp={() => {
        const drag = dragRef.current;
        if (!drag) {
          return;
        }
        dragRef.current = null;
        setResizing(false);
        if (drag.width !== drag.startWidth) {
          setWidth(drag.width, { persist: true });
        }
      }}
      tabIndex={-1}
      title={isCollapsed ? t("expandSidebar") : t("resizeSidebarHint")}
      type="button"
      {...props}
    />
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      className={cn(
        "relative flex w-full flex-1 flex-col bg-background",
        "md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2 md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm",
        className
      )}
      data-slot="sidebar-inset"
      {...props}
    />
  );
}

function SidebarInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn("h-8 w-full bg-background shadow-none", className)}
      data-sidebar="input"
      data-slot="sidebar-input"
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="header"
      data-slot="sidebar-header"
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="footer"
      data-slot="sidebar-footer"
      {...props}
    />
  );
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      data-sidebar="separator"
      data-slot="sidebar-separator"
      {...props}
    />
  );
}

function SidebarContent({
  className,
  onScroll,
  ...props
}: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = React.useState({
    bottom: false,
    top: false,
  });
  const measure = React.useCallback(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const top = element.scrollTop > 1;
    const bottom =
      element.scrollTop + element.clientHeight < element.scrollHeight - 1;
    setOverflow((previous) =>
      previous.top === top && previous.bottom === bottom
        ? previous
        : { bottom, top }
    );
  }, []);
  React.useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-1 overflow-auto overscroll-contain group-data-[collapsible=icon]:overflow-hidden",
        "data-[overflow-top]:mask-t-from-[calc(100%-1.5rem)] data-[overflow-bottom]:mask-b-from-[calc(100%-1.5rem)]",
        className
      )}
      data-overflow-bottom={overflow.bottom || undefined}
      data-overflow-top={overflow.top || undefined}
      data-sidebar="content"
      data-slot="sidebar-content"
      onScroll={(event) => {
        measure();
        onScroll?.(event);
      }}
      ref={ref}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative flex w-full min-w-0 flex-col px-2 py-1",
        className
      )}
      data-sidebar="group"
      data-slot="sidebar-group"
      {...props}
    />
  );
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      className={cn(
        "flex h-6 shrink-0 items-center rounded-md px-[9px] font-medium text-[11px] text-sidebar-foreground/60 outline-hidden ring-sidebar-ring transition-[margin,opacity] duration-150 ease-out focus-visible:ring-2 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-sidebar-foreground [&>svg]:opacity-60",
        "group-data-[collapsible=icon]:-mt-6 group-data-[collapsible=icon]:opacity-0",
        className
      )}
      data-sidebar="group-label"
      data-slot="sidebar-group-label"
      {...props}
    />
  );
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(
        "absolute top-1.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:opacity-50 [&>svg]:transition-opacity hover:[&>svg]:opacity-100",
        "after:absolute after:-inset-2 md:after:hidden",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      data-sidebar="group-action"
      data-slot="sidebar-group-action"
      {...props}
    />
  );
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("w-full text-sm", className)}
      data-sidebar="group-content"
      data-slot="sidebar-group-content"
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn("flex w-full min-w-0 flex-col gap-px", className)}
      data-sidebar="menu"
      data-slot="sidebar-menu"
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn("group/menu-item relative", className)}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
      {...props}
    />
  );
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md px-[9px] py-0 text-left text-[13px] text-sidebar-foreground/75 outline-hidden ring-sidebar-ring transition-[width,height,padding,background-color,color] duration-150 ease-out hover:bg-sidebar-accent/70 hover:text-sidebar-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:h-7! group-data-[collapsible=icon]:w-8! group-data-[collapsible=icon]:px-[9px]! [&>span:last-child]:truncate [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-sidebar-foreground [&>svg]:opacity-55 [&>svg]:transition-[color,opacity] hover:[&>svg]:opacity-80 data-[active=true]:[&>svg]:text-sidebar-accent-foreground data-[active=true]:[&>svg]:opacity-100",
  {
    variants: {
      variant: {
        default: "",
        outline:
          "bg-background shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_var(--sidebar-accent)]",
      },
      size: {
        default: "h-7",
        sm: "h-6 text-xs",
        lg: "h-12 text-sm group-data-[collapsible=icon]:p-0!",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean;
  isActive?: boolean;
  tooltip?: string | React.ComponentProps<typeof TooltipContent>;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot : "button";
  const { isMobile, state } = useSidebar();
  const [tooltipOpen, setTooltipOpen] = React.useState(false);

  const button = (
    <Comp
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      data-active={isActive}
      data-sidebar="menu-button"
      data-size={size}
      data-slot="sidebar-menu-button"
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    };
  }

  // Tooltips only help when the labels are hidden (collapsed to icons). Kept
  // closed otherwise: an open tooltip would take the drawer's first Escape.
  // Always controlled, so collapsing never switches Radix between modes.
  const showTooltip = state === "collapsed" && !isMobile;
  return (
    <Tooltip onOpenChange={setTooltipOpen} open={showTooltip && tooltipOpen}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent align="center" side="right" {...tooltip} />
    </Tooltip>
  );
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean;
  showOnHover?: boolean;
}) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(
        "absolute top-1 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-border/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 peer-hover/menu-button:text-sidebar-accent-foreground [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:opacity-60 [&>svg]:transition-opacity hover:[&>svg]:opacity-100 peer-hover/menu-button:[&>svg]:opacity-100",
        "after:absolute after:-inset-2 md:after:hidden",
        "peer-data-[size=sm]/menu-button:top-1",
        "peer-data-[size=default]/menu-button:top-1",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        showOnHover &&
          "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 peer-data-[active=true]/menu-button:text-sidebar-accent-foreground md:opacity-0",
        className
      )}
      data-sidebar="menu-action"
      data-slot="sidebar-menu-action"
      {...props}
    />
  );
}

function SidebarMenuBadge({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute right-1 flex h-5 min-w-5 select-none items-center justify-center rounded-md px-1 text-[11px] text-sidebar-foreground/45 tabular-nums",
        "peer-data-[active=true]/menu-button:text-sidebar-accent-foreground/70",
        "peer-data-[size=sm]/menu-button:top-0.5",
        "peer-data-[size=default]/menu-button:top-1",
        "peer-data-[size=lg]/menu-button:top-2.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      data-sidebar="menu-badge"
      data-slot="sidebar-menu-badge"
      {...props}
    />
  );
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  width = "70%",
  ...props
}: React.ComponentProps<"div"> & {
  showIcon?: boolean;
  width?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-[9px]",
        className
      )}
      data-sidebar="menu-skeleton"
      data-slot="sidebar-menu-skeleton"
      {...props}
    >
      {showIcon ? (
        <Skeleton
          className="size-3.5 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      ) : null}
      <Skeleton
        className="h-3 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            "--skeleton-width": width,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-sidebar-border border-l px-2.5 py-0.5",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      data-sidebar="menu-sub"
      data-slot="sidebar-menu-sub"
      {...props}
    />
  );
}

function SidebarMenuSubItem({
  className,
  ...props
}: React.ComponentProps<"li">) {
  return (
    <li
      className={cn("group/menu-sub-item relative", className)}
      data-sidebar="menu-sub-item"
      data-slot="sidebar-menu-sub-item"
      {...props}
    />
  );
}

function SidebarMenuSubButton({
  asChild = false,
  size = "md",
  isActive = false,
  className,
  ...props
}: React.ComponentProps<"a"> & {
  asChild?: boolean;
  size?: "sm" | "md";
  isActive?: boolean;
}) {
  const Comp = asChild ? Slot : "a";

  return (
    <Comp
      className={cn(
        "flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground outline-hidden ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-accent-foreground",
        "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
        size === "sm" && "text-xs",
        size === "md" && "text-sm",
        "group-data-[collapsible=icon]:hidden",
        className
      )}
      data-active={isActive}
      data-sidebar="menu-sub-button"
      data-size={size}
      data-slot="sidebar-menu-sub-button"
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useOptionalSidebar,
  useSidebar,
};
