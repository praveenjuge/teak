import { LOCALE_COOKIE, SUPPORTED_LOCALES } from "@teak/i18n";
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
  // Routes set their own name ("Settings" becomes "Settings · Teak").
  title: { default: "Teak", template: "%s · Teak" },
  description:
    "Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations",
  openGraph: {
    title: "Teak",
    description: "A personal knowledge hub for creative minds",
  },
};

// The static shell can't read cookies, so it says "en"; this sets the
// language the cookie asks for before the first paint, so fonts and line
// breaking for Chinese, Japanese and Korean apply from the start.
const HTML_LANG_FROM_COOKIE = `try{var m=document.cookie.match(/(?:^|; )${LOCALE_COOKIE}=([^;]+)/);if(m&&${JSON.stringify(SUPPORTED_LOCALES)}.indexOf(m[1])>-1)document.documentElement.lang=m[1]}catch(e){}`;

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html
      className={`${snPro.variable} ${snProItalic.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed script with no user input, so <html lang> is right before first paint.
          dangerouslySetInnerHTML={{ __html: HTML_LANG_FROM_COOKIE }}
        />
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
