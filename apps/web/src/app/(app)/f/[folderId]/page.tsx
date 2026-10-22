import type { Metadata } from "next";
import { FolderPageClient } from "./FolderPageClient";

export const metadata: Metadata = { title: "Folder" };

export const instant = false;

export default function FolderPage() {
  return <FolderPageClient />;
}
