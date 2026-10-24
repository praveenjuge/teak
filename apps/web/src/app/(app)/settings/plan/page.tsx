import type { Metadata } from "next";
import { PlanPageClient } from "../SettingsPageClient";

export const metadata: Metadata = { title: "Plan · Settings" };

export const instant = false;

export default function PlanPage() {
  return <PlanPageClient />;
}
