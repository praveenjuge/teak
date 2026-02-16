import { ConvexReactClient } from "convex/react";

const convexUrl = import.meta.env.VITE_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error("Missing VITE_PUBLIC_CONVEX_URL in desktop environment");
}

export const convex = new ConvexReactClient(convexUrl, {
  expectAuth: true,
  unsavedChangesWarning: false,
});
