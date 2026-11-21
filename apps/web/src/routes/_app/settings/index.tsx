import { createFileRoute } from "@tanstack/react-router";
import { SettingsError } from "@/components/settings/SettingsError";
import { titleHead } from "@/lib/pageTitle";
import { SettingsPageClient } from "@/screens/SettingsScreen";

export const Route = createFileRoute("/_app/settings/")({
  head: titleHead("Settings"),
  errorComponent: SettingsError,
  component: SettingsPageClient,
});
