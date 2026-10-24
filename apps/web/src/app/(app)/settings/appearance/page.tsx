import type { Metadata } from "next";
import { AppearancePageClient } from "../SettingsPageClient";

export const metadata: Metadata = { title: "Appearance · Settings" };

export const instant = false;

export default function AppearancePage() {
  return <AppearancePageClient />;
}
