"use client";

import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { useTranslations } from "@teak/i18n/react";
import { useEffect } from "react";
import { SidebarToggle } from "@/components/sidebar/SidebarToggle";
import { Button } from "@/components/ui/button";

/**
 * A page that failed to render, shown inside the app shell so the sidebar
 * (or, on phones, its toggle) still works.
 */
export function SegmentErrorScreen({
  boundary,
  error,
  withSidebarToggle = true,
}: {
  boundary: string;
  error: Error & { digest?: string };
  /** Off where the page around it already has the phone's sidebar toggle. */
  withSidebarToggle?: boolean;
}) {
  const t = useTranslations();
  useEffect(() => {
    captureClientException(error, {
      digest: error.digest,
      "ui.boundary": boundary,
    });
  }, [boundary, error]);
  return (
    <>
      {withSidebarToggle ? (
        <div className="flex h-12 items-center md:hidden">
          <SidebarToggle className="-ml-2" />
        </div>
      ) : null}
      <div
        className="flex flex-col items-center gap-4 py-24 text-center"
        role="alert"
      >
        <p className="text-balance text-muted-foreground">
          {t("app.globalError.message")}
        </p>
        <Button
          // A retry would read the same failed queries from the cache; a
          // reload asks the server again.
          onClick={() => {
            window.location.reload();
          }}
          variant="outline"
        >
          {t("common.tryAgain")}
        </Button>
      </div>
    </>
  );
}
