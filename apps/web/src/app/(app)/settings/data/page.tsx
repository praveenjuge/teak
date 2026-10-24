import type { Metadata } from "next";
import { DataPageClient } from "../SettingsPageClient";

export const metadata: Metadata = { title: "Import & export · Settings" };

export const instant = false;

export default function DataPage() {
  return <DataPageClient />;
}
