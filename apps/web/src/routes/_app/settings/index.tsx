import { createFileRoute, redirect } from "@tanstack/react-router";
import { SETTINGS_PATHS } from "@teak/convex/shared/webRoutes";
import { SettingsError } from "@/components/settings/SettingsError";
import {
  parseSettingsDialogParam,
  settingsDataHref,
} from "@/lib/commandPalette";
import { prewarmPageLoader } from "@/lib/convexClient";
import { titleHead } from "@/lib/pageTitle";
import { SettingsPage } from "@/screens/SettingsScreen";

export const Route = createFileRoute("/_app/settings/")({
  loader: prewarmPageLoader,
  // Old links opened import and export as a dialog (`?dialog=import`); they
  // now go to that section of Import & export, and anything else to Settings.
  beforeLoad: ({ search }) => {
    if (search.dialog === undefined) {
      return;
    }
    const tab = parseSettingsDialogParam(search.dialog);
    throw redirect({
      href: tab ? settingsDataHref(tab) : SETTINGS_PATHS.account,
      replace: true,
    });
  },
  head: titleHead((t) => t("settings.header.title")),
  errorComponent: SettingsError,
  component: SettingsPage,
});
