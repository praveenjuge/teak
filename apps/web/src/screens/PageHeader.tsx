"use client";

import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/utils";

interface PageHeaderProps {
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  leading?: ReactNode;
  title?: ReactNode;
}

export function PageHeader({
  actions,
  children,
  className,
  leading,
  title,
}: PageHeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 4);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-4 mb-3 border-transparent border-b bg-background/85 px-4 backdrop-blur-md transition-colors duration-150 data-[scrolled]:border-border",
        className
      )}
      data-page-header=""
      data-scrolled={scrolled || undefined}
    >
      {/* On wide screens: title on the left, the search in a fixed middle
          slot, actions on the right, so the search sits in the same place on
          every page. On phones the pieces share one row. */}
      <div className="relative flex h-13 items-center gap-2 sm:grid sm:grid-cols-[minmax(6rem,1fr)_minmax(0,36rem)_minmax(auto,1fr)] sm:gap-4">
        <div className="flex min-w-0 items-center gap-2 max-sm:contents">
          {leading}
          {title}
        </div>
        {children ?? <div className="max-sm:hidden" />}
        <div className="flex items-center justify-end gap-2 max-sm:contents">
          {actions}
        </div>
      </div>
    </div>
  );
}

export function PageTitle({
  children,
  className,
  count,
  icon,
  trailing,
}: {
  children: ReactNode;
  className?: string;
  count?: ReactNode;
  icon?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 pr-2 max-sm:flex-1",
        className
      )}
    >
      {icon}
      <h1 className="min-w-0 truncate font-medium text-sm" dir="auto">
        {children}
      </h1>
      {count !== undefined && count !== null && (
        <span className="shrink-0 text-muted-foreground text-sm tabular-nums">
          {count}
        </span>
      )}
      {trailing}
    </div>
  );
}
