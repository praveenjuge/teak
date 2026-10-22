import type { Metadata } from "next";
import { TagsPageClient } from "./TagsPageClient";

export const metadata: Metadata = { title: "Tags" };

export const instant = false;

export default function TagsPage() {
  return <TagsPageClient />;
}
