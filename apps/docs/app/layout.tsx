import "@/app/global.css";
import { RootProvider } from "fumadocs-ui/provider";
import type { ReactNode } from "react";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    template: "%s | Teak",
    default: "Teak - Personal Knowledge Hub",
  },
  description:
    "Teak, a streamlined personal knowledge hub for creative minds. Learn how to set up and use Teak across web, mobile, and browser extension platforms.",
  metadataBase: new URL("https://teakvault.com"),
  keywords:
    "teak, personal knowledge management, setup guide, API reference, cross-platform sync",
  authors: [{ name: "Teak Team" }],
  openGraph: {
    title: "Teak",
    description:
      "Complete guide to setting up and using Teak across all platforms",
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
      <body className="flex min-h-screen flex-col antialiased">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
