import type { Metadata } from "next";
import { LibraryScreen } from "@/screens/LibraryScreen";

export const metadata: Metadata = { title: "Archive" };

export const instant = false;

export default function ArchivePage() {
  return <LibraryScreen view="archive" />;
}
