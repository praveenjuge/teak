import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import "./globals.css";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import type { PropsWithChildren } from "react";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import {
  JsonLd,
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/components/JsonLd";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Teak",
  description:
    "Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations",
  openGraph: {
    title: "Teak",
    description: "A personal knowledge hub for creative minds",
  },
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <JsonLd
          schema={[
            organizationSchema,
            websiteSchema,
            softwareApplicationSchema,
          ]}
        />
      </head>
      <body className='touch-manipulation font-sans text-sm antialiased caret-primary accent-primary [font-feature-settings:"ss01"] [text-rendering:optimizeLegibility] selection:bg-primary selection:text-primary-foreground'>
        <ConvexClientProvider>
          <ConvexQueryCacheProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              disableTransitionOnChange
              enableSystem={true}
            >
              <main className="mx-auto max-w-7xl px-4 pb-10">{children}</main>
            </ThemeProvider>
          </ConvexQueryCacheProvider>
        </ConvexClientProvider>
        <Toaster position="bottom-center" />
        <Analytics />
      </body>
    </html>
  );
}
