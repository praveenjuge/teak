"use client";

import { Button } from "@teak/ui/components/ui/button";
import { useOptionalSidebar } from "@teak/ui/components/ui/sidebar";
import { PanelLeft } from "lucide-react";
import { cn } from "../../lib/utils";

/**
 * Opens and closes the sidebar (the drawer on phones). On a desktop with
 * the sidebar open it stays out of the way (the sidebar has its own
 * Collapse button); it shows once the sidebar is collapsed. Renders nothing
 * outside a SidebarProvider, so screens work without the app shell.
 */
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
        // A class, not a render branch, so the server and phones agree.
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
