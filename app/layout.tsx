import type { Metadata } from "next";
import "./globals.css";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

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
      <body className="text-sm antialiased caret-primary accent-primary selection:bg-primary selection:text-primary-foreground [font-feature-settings:&quot;ss02&quot;,_&quot;ss03&quot;,_&quot;ss04&quot;,_&quot;ss07&quot;,_&quot;ss08&quot;,_&quot;ss09&quot;] [text-rendering:optimizeLegibility] [touch-action:manipulation]">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          disableTransitionOnChange
        >
          <ClerkProvider
            dynamic
            signInUrl="/login"
            signUpUrl="/register"
            appearance={{
              theme: "simple",
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
