"use client";

import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { useEffect } from "react";
import "./globals.css";
import { StatusScreen } from "@/components/StatusScreen";

// global-error replaces the root layout, so next-themes isn't running. Apply
// the theme it saved ("light", "dark" or "system"), or the system one.
const readSavedTheme = (): string | null => {
  try {
    return localStorage.getItem("theme");
  } catch {
    return null;
  }
};

const applySavedTheme = () => {
  const saved = readSavedTheme();
  const dark =
    saved === "dark" ||
    (saved !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
};

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    captureClientException(error, { digest: error.digest });
  }, [error]);
  useEffect(applySavedTheme, []);
  return (
    // global-error must include html and body tags
    <html lang="en">
      <body className="font-sans text-sm antialiased">
        <StatusScreen
          action="Try again"
          message="Something went wrong. Please try again."
          onAction={() => retry()}
        />
      </body>
    </html>
  );
}
