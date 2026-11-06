import type { Metadata } from "next";
import { LibraryScreen } from "@/screens/LibraryScreen";

export const metadata: Metadata = { title: "Trash" };

export const instant = false;

export default function TrashPage() {
  return <LibraryScreen view="trash" />;
}
