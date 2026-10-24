import type { Metadata } from "next";
import { OpenLinkPageClient } from "./OpenLinkPageClient";

export const metadata: Metadata = { title: "Opening link" };

// The layout waits on the session check, so this page may block.
export const instant = false;

export default function OpenLinkPage() {
  return <OpenLinkPageClient />;
}
