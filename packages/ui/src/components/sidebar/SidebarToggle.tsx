"use client";

import { Button } from "@teak/ui/components/ui/button";
import { useOptionalSidebar } from "@teak/ui/components/ui/sidebar";
import { PanelLeft } from "lucide-react";
import { cn } from "../../lib/utils";

export function SidebarToggle({ className }: { className?: string }) {
  const sidebar = useOptionalSidebar();
  if (!sidebar) {
    return null;
  }
  const isOpen = sidebar.isMobile ? sidebar.openMobile : sidebar.open;
  return (
    <Button
      aria-expanded={isOpen}
      aria-label="Toggle sidebar"
      className={cn(
        "size-8 shrink-0 text-muted-foreground",
        sidebar.open && "md:hidden",
        className
      )}
      data-sidebar="trigger"
      onClick={sidebar.toggleSidebar}
      size="icon"
      type="button"
      variant="ghost"
    >
      <PanelLeft className="size-4" />
    </Button>
  );
}
