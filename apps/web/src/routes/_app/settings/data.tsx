import { createFileRoute } from "@tanstack/react-router";
import { SettingsError } from "@/components/settings/SettingsError";
import { titleHead } from "@/lib/pageTitle";
import { DataPageClient } from "@/screens/SettingsScreen";

export const Route = createFileRoute("/_app/settings/data")({
  head: titleHead("Import & export · Settings"),
  errorComponent: SettingsError,
  component: DataPageClient,
});
