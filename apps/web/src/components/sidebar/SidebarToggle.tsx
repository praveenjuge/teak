"use client";

import { useTranslations } from "@teak/i18n/react";
import { PanelLeft } from "vadivam-react";
import { Button } from "@/components/ui/button";
import { useOptionalSidebar } from "@/components/ui/sidebar";
import { cn } from "../../lib/utils";

export function SidebarToggle({ className }: { className?: string }) {
  const t = useTranslations("sidebar");
  const sidebar = useOptionalSidebar();
  if (!sidebar) {
    return null;
  }
  const isOpen = sidebar.isMobile ? sidebar.openMobile : sidebar.open;
  return (
    <Button
      aria-expanded={isOpen}
      aria-label={t("toggle")}
      className={cn(
        // On wide screens the sidebar's own header holds the toggle, open or collapsed.
        "size-8 shrink-0 text-muted-foreground md:hidden",
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
