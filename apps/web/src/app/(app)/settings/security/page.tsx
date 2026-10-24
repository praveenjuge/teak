import type { Metadata } from "next";
import { SecurityPageClient } from "../SettingsPageClient";

export const metadata: Metadata = { title: "Security · Settings" };

export const instant = false;

export default function SecurityPage() {
  return <SecurityPageClient />;
}
