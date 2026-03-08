import { ConvexReactClient } from "convex/react";
import { getDesktopConfig } from "@/lib/desktop-config";

export const convex = new ConvexReactClient(getDesktopConfig().convexUrl, {
  expectAuth: true,
  unsavedChangesWarning: false,
});
