import type { Metadata } from "next";
import { LibraryScreen } from "@/screens/LibraryScreen";

export const metadata: Metadata = { title: "Favorites" };

export const instant = false;

export default function FavoritesPage() {
  return <LibraryScreen view="favorites" />;
}
