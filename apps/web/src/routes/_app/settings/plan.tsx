import { createFileRoute } from "@tanstack/react-router";
import { SettingsError } from "@/components/settings/SettingsError";
import { prewarmPageLoader } from "@/lib/convexClient";
import { titleHead } from "@/lib/pageTitle";
import { PlanPage } from "@/screens/SettingsScreen";

export const Route = createFileRoute("/_app/settings/plan")({
  loader: prewarmPageLoader,
  head: titleHead((t) =>
    t("settings.header.subpageTitle", { page: t("settings.nav.plan") })
  ),
  errorComponent: SettingsError,
  component: PlanPage,
});
