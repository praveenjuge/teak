import type { Metadata } from "next";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Teak",
  description:
    "Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className='font-sans text-sm antialiased caret-primary accent-primary selection:bg-primary selection:text-primary-foreground [font-feature-settings:"ss01"] [text-rendering:optimizeLegibility] touch-manipulation'>
        <ConvexClientProvider>
          <ConvexQueryCacheProvider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              disableTransitionOnChange
              enableSystem={true}
            >
              {children}
            </ThemeProvider>
          </ConvexQueryCacheProvider>
        </ConvexClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
