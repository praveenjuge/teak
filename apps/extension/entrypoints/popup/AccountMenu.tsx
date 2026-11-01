import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Ellipsis } from "vadivam-react";

export interface SessionUser {
  email: string;
  id: string;
  image?: string;
  name?: string;
}

export const menuItemClass =
  "flex h-8 w-full cursor-default items-center gap-2 rounded-lg px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:opacity-50 aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/**
 * The "⋯" button in the popup's header and the menu it opens: the account's
 * email, then `children` as menu items (`menuItemClass`).
 */
export function AccountMenu({
  children,
  label,
  user,
}: {
  children: ReactNode;
  label: string;
  user: SessionUser;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    root.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled])')
      ?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const items = [
      ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []),
    ];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items.at((at + step) % items.length)?.focus();
  };

  return (
    <div className="relative" ref={root}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-expanded:bg-accent aria-expanded:text-foreground"
        onClick={() => setOpen((value) => !value)}
        ref={trigger}
        type="button"
      >
        <Ellipsis aria-hidden="true" className="size-4" />
      </button>
      {open ? (
        <div
          aria-label={label}
          className="absolute top-full right-0 z-20 mt-1.5 w-60 origin-top-right starting:scale-95 rounded-xl border bg-popover p-1 starting:opacity-0 shadow-black/5 shadow-lg transition-[opacity,scale] duration-150"
          id={menuId}
          // Closes after a pick; the items keep their own handlers.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[role="menuitem"]')) {
              setOpen(false);
            }
          }}
          onKeyDown={handleKeyDown}
          role="menu"
        >
          <p
            className="truncate px-2 pt-1.5 pb-2 text-muted-foreground text-xs"
            title={user.email}
          >
            {user.email}
          </p>
          {children}
        </div>
      ) : null}
    </div>
  );
}
