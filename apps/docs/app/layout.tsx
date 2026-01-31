import "@/app/global.css";
import { Analytics } from "@vercel/analytics/next";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";
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
      <body className="flex min-h-screen flex-col font-sans text-base antialiased [font-feature-settings:'ss01'] [text-rendering:optimizeLegibility]">
        <RootProvider
          search={{
            enabled: false,
          }}
          theme={{
            enabled: false,
          }}
        >
          {/* Background Pattern */}
          <div className="pointer-events-none absolute top-0 left-0 -z-10 h-[600px] w-full overflow-hidden">
            <BackgroundPattern />
          </div>
          {children}
        </RootProvider>
        <Analytics />
      </body>
    </html>
  );
}
