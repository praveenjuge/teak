import type { Metadata } from "next";
import { HomePageClient } from "../../HomePageClient";

export const metadata: Metadata = { title: "Archive" };

export const instant = false;

export default function ArchivePage() {
  return <HomePageClient view="archive" />;
}
