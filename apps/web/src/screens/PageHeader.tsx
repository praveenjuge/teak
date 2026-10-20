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
      <div className="relative flex h-13 items-center gap-2">
        {leading}
        {title}
        {children}
        {actions}
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
        "flex min-w-0 items-center gap-2 pr-2 max-sm:flex-1 sm:max-w-[40%] sm:shrink-0",
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
