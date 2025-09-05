import type { Metadata } from "next";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { shadcn } from "@clerk/themes";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";

export const metadata: Metadata = {
  title: "Teak",
  description:
    "Teak is a streamlined personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className='text-sm antialiased caret-primary accent-primary selection:bg-primary selection:text-primary-foreground [font-feature-settings:"ss02",_"ss03",_"ss04",_"ss07",_"ss08",_"ss09"] [text-rendering:optimizeLegibility] [touch-action:manipulation]'>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          disableTransitionOnChange
        >
          <ClerkProvider
            signInUrl="/login"
            signUpUrl="/register"
            appearance={{
              baseTheme: shadcn,
              elements: {
                cardBox: "!w-full !shadow-none",
              },
            }}
          >
            <ConvexClientProvider>
              <ConvexQueryCacheProvider>
                {children}
                <Toaster />
              </ConvexQueryCacheProvider>
            </ConvexClientProvider>
          </ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
