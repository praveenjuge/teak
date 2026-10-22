import type { Metadata } from "next";
import { HomePageClient } from "../../HomePageClient";

export const metadata: Metadata = { title: "Trash" };

export const instant = false;

export default function TrashPage() {
  return <HomePageClient view="trash" />;
}
