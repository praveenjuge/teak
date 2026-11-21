import { createFileRoute } from "@tanstack/react-router";
import { SettingsError } from "@/components/settings/SettingsError";
import { titleHead } from "@/lib/pageTitle";
import { AppearancePageClient } from "@/screens/SettingsScreen";

export const Route = createFileRoute("/_app/settings/appearance")({
  head: titleHead("Appearance · Settings"),
  errorComponent: SettingsError,
  component: AppearancePageClient,
});
