import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import type { PropsWithChildren } from "react";
import { JsonLd } from "@/components/JsonLd";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import {
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/lib/jsonld";

const snPro = localFont({
  src: "../styles/fonts/SNPro-VariableRegular.woff2",
  weight: "200 900",
  style: "normal",
  variable: "--font-sn-pro",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "font-family", value: "SN Pro" }],
});
const snProItalic = localFont({
  src: "../styles/fonts/SNPro-VariableItalic.woff2",
  weight: "200 900",
  style: "italic",
  variable: "--font-sn-pro-italic",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "font-family", value: "SN Pro" }],
  preload: false,
});

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
    <html
      className={`${snPro.variable} ${snProItalic.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <link href="//files.teakvault.com" rel="dns-prefetch" />
        <link href="https://files.teakvault.com" rel="preconnect" />
        <JsonLd
          schema={[
            organizationSchema,
            websiteSchema,
            softwareApplicationSchema,
          ]}
        />
      </head>
      <body className='touch-manipulation font-features-["ss01"] font-sans text-sm antialiased caret-primary accent-primary [text-rendering:optimizeLegibility] selection:bg-primary selection:text-primary-foreground'>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem={true}
        >
          {children}
          <Toaster position="bottom-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
