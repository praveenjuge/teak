import type { Metadata } from "next";
import { HomePageClient } from "../../HomePageClient";

export const metadata: Metadata = { title: "Favorites" };

export const instant = false;

export default function FavoritesPage() {
  return <HomePageClient view="favorites" />;
}
