import { createFileRoute } from "@tanstack/react-router";
import { SettingsError } from "@/components/settings/SettingsError";
import { prewarmPageLoader } from "@/lib/convexClient";
import { titleHead } from "@/lib/pageTitle";
import { DataPage } from "@/screens/SettingsScreen";

export const Route = createFileRoute("/_app/settings/data")({
  loader: prewarmPageLoader,
  head: titleHead((t) =>
    t("settings.header.subpageTitle", { page: t("settings.nav.data") })
  ),
  errorComponent: SettingsError,
  component: DataPage,
});
