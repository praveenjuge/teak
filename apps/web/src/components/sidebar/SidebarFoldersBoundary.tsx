"use client";

import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { useTranslations } from "@teak/i18n/react";
import type { ReactNode } from "react";
import { RetryableQueryBoundary } from "@/components/feedback/RetryableQueryBoundary";
import { SidebarGroup, SidebarGroupLabel } from "@/components/ui/sidebar";

function SidebarFoldersError() {
  const t = useTranslations("sidebar.folders");
  const tc = useTranslations("common");
  return (
    <SidebarGroup className="pt-3 group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t("title")}</SidebarGroupLabel>
      <div className="px-2 pt-0.5" role="alert">
        <p className="text-balance text-[12px] text-sidebar-foreground/55 leading-snug">
          {t("loadFailed")}
        </p>
        <button
          className="mt-2 inline-flex h-7 items-center rounded-md bg-sidebar-accent px-2.5 font-medium text-[12px] text-sidebar-foreground outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-border focus-visible:ring-2"
          // The query cache would hand a retry the same error; a reload asks
          // the server again.
          onClick={() => window.location.reload()}
          type="button"
        >
          {tc("tryAgain")}
        </button>
      </div>
    </SidebarGroup>
  );
}

/**
 * Keeps a failed folders read inside the sidebar, so the rest of the app
 * stays usable instead of falling to the full-screen error page.
 */
export function SidebarFoldersBoundary({ children }: { children: ReactNode }) {
  return (
    <RetryableQueryBoundary
      fallback={() => <SidebarFoldersError />}
      onCatch={(error) =>
        captureClientException(error, { "ui.boundary": "sidebar-folders" })
      }
    >
      {() => children}
    </RetryableQueryBoundary>
  );
}
