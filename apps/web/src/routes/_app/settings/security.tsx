import { createFileRoute } from "@tanstack/react-router";
import { SettingsError } from "@/components/settings/SettingsError";
import { titleHead } from "@/lib/pageTitle";
import { SecurityPageClient } from "@/screens/SettingsScreen";

export const Route = createFileRoute("/_app/settings/security")({
  head: titleHead("Security · Settings"),
  errorComponent: SettingsError,
  component: SecurityPageClient,
});
