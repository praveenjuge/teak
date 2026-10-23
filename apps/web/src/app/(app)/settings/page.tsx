import type { Metadata } from "next";
import { SettingsPageClient } from "./SettingsPageClient";

export const metadata: Metadata = { title: "Settings" };

export const instant = false;

export default function SettingsPage() {
  return <SettingsPageClient />;
}
