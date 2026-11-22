import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { useTranslations } from "@teak/i18n/react";
import { useEffect } from "react";
import { CookieLocaleProvider } from "@/components/providers/CookieLocaleProvider";
import { StatusScreen } from "@/components/StatusScreen";

function RootErrorScreen({ retry }: { retry: () => void }) {
  const t = useTranslations();
  return (
    <StatusScreen
      action={t("common.tryAgain")}
      message={t("app.globalError.message")}
      onAction={retry}
    />
  );
}

/**
 * The whole page failed: the root route's error screen. It reports the
 * error, and Try again re-runs the loaders that failed.
 */
export function RootError({ error }: ErrorComponentProps) {
  const router = useRouter();
  useEffect(() => {
    captureClientException(error);
  }, [error]);
  return (
    <CookieLocaleProvider>
      {/* Invalidating re-runs the loaders that failed and gives every match
          a new identity, which resets the error boundaries keyed on them; a
          reset alone would show the same failed load again. */}
      <RootErrorScreen retry={() => router.invalidate()} />
    </CookieLocaleProvider>
  );
}
