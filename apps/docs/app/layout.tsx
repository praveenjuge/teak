import "@/app/global.css";
import { RootProvider } from "fumadocs-ui/provider";
import type { ReactNode } from "react";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s | Teak",
    default: "Teak - Visual Bookmarking & Design Inspiration Manager",
  },
  description:
    "Teak, the visual bookmarking tool made for designers and developers. Learn how to organize design inspiration and manage visual bookmarks across all platforms.",
  metadataBase: new URL("https://teakvault.com"),
  keywords:
    "teak, visual bookmarking, design inspiration management, design bookmarks, visual inspiration, design workflow, developer resources",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Teak - Visual Bookmarking & Design Inspiration Manager",
    description:
      "Complete guide to setting up and using Teak for visual bookmarking and design inspiration management across all platforms",
    type: "website",
    siteName: "Teak",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans flex min-h-screen flex-col antialiased text-sm [font-feature-settings:'ss01'] [text-rendering:optimizeLegibility]">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
