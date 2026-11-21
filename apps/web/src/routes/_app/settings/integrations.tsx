import { createFileRoute } from "@tanstack/react-router";
import { SettingsError } from "@/components/settings/SettingsError";
import { titleHead } from "@/lib/pageTitle";
import { IntegrationsPageClient } from "@/screens/SettingsScreen";

export const Route = createFileRoute("/_app/settings/integrations")({
  head: titleHead("Integrations · Settings"),
  errorComponent: SettingsError,
  component: IntegrationsPageClient,
});
