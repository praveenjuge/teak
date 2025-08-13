import type { Metadata } from "next";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { shadcn } from "@clerk/themes";

export const metadata: Metadata = {
  title: "Teak",
  description: "Teak",
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
                cardBox: "!w-full !shadow-none !border",
                footer: "[&>div:nth-child(2)]:hidden",
              },
            }}
          >
            <ConvexClientProvider>{children}</ConvexClientProvider>
            <Toaster />
          </ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
