import type { Metadata } from "next";
import { IntegrationsPageClient } from "../SettingsPageClient";

export const metadata: Metadata = { title: "Integrations · Settings" };

export const instant = false;

export default function IntegrationsPage() {
  return <IntegrationsPageClient />;
}
