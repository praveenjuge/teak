import "@/app/global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { BackgroundPattern } from "@/components/BackgroundPattern";

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
  twitter: {
    card: "summary_large_image",
    title: "Teak - Visual Bookmarking & Design Inspiration Manager",
    description:
      "Complete guide to setting up and using Teak for visual bookmarking and design inspiration management across all platforms",
    images: ["/hero-image.png"],
  },
  openGraph: {
    title: "Teak - Visual Bookmarking & Design Inspiration Manager",
    description:
      "Complete guide to setting up and using Teak for visual bookmarking and design inspiration management across all platforms",
    type: "website",
    siteName: "Teak",
    locale: "en_US",
    images: [
      {
        url: "/hero-image.png",
        width: 1200,
        height: 630,
        alt: "Teak - Visual Bookmarking & Design Inspiration Manager",
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans flex min-h-screen flex-col antialiased text-base [font-feature-settings:'ss01'] [text-rendering:optimizeLegibility]">
        <RootProvider
          search={{
            enabled: false,
          }}
          theme={{
            enabled: false,
          }}
        >
          {/* Background Pattern */}
          <div className="absolute top-0 left-0 w-full h-[600px] overflow-hidden pointer-events-none -z-10">
            <BackgroundPattern />
          </div>
          {children}
        </RootProvider>
        <Analytics />
      </body>
    </html>
  );
}
