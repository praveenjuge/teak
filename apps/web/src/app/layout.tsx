import { LOCALE_COOKIE, SUPPORTED_LOCALES } from "@teak/i18n";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import type { PropsWithChildren } from "react";
import { JsonLd } from "@/components/JsonLd";
import { ShareWorkerRegistration } from "@/components/providers/ShareWorkerRegistration";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { APP_BACKGROUND_COLOR } from "@/lib/appTheme";
import {
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/lib/jsonld";
import { filesOrigin } from "@/lib/public-env";
import {
  SIDEBAR_COOKIE_NAME,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_COOKIE_NAME,
} from "@/lib/sidebarState";

const FILES_ORIGIN = filesOrigin();

const allo = localFont({
  src: "../styles/fonts/AlloVariableFriendly.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-allo",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "font-family", value: "Allo" }],
});
const alloOblique = localFont({
  src: [
    {
      path: "../styles/fonts/Allo-Oblique.woff2",
      weight: "400",
      style: "italic",
    },
    {
      path: "../styles/fonts/Allo-MediumOblique.woff2",
      weight: "500",
      style: "italic",
    },
    {
      path: "../styles/fonts/Allo-SemiBoldOblique.woff2",
      weight: "600",
      style: "italic",
    },
    {
      path: "../styles/fonts/Allo-BoldOblique.woff2",
      weight: "700",
      style: "italic",
    },
  ],
  variable: "--font-allo-oblique",
  display: "swap",
  adjustFontFallback: false,
  declarations: [{ prop: "font-family", value: "Allo" }],
  preload: false,
});

export const metadata: Metadata = {
  title: { default: "Teak", template: "%s · Teak" },
  description:
    "Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations",
  openGraph: {
    title: "Teak",
    description: "A personal knowledge hub for creative minds",
  },
};

export const viewport: Viewport = {
  themeColor: [
    {
      media: "(prefers-color-scheme: light)",
      color: APP_BACKGROUND_COLOR.light,
    },
    { media: "(prefers-color-scheme: dark)", color: APP_BACKGROUND_COLOR.dark },
  ],
};

// The static shell can't read cookies, so it says "en"; this sets the
// language the cookie asks for before the first paint, so fonts and line
// breaking for Chinese, Japanese and Korean apply from the start.
const HTML_LANG_FROM_COOKIE = `try{var m=document.cookie.match(/(?:^|; )${LOCALE_COOKIE}=([^;]+)/);if(m&&${JSON.stringify(SUPPORTED_LOCALES)}.indexOf(m[1])>-1)document.documentElement.lang=m[1]}catch(e){}`;

// Same for the sidebar: the app's loading frame reads these to draw the
// column at the width, and in the state, people left it.
const SIDEBAR_FROM_COOKIE = `try{var d=document.documentElement,c=document.cookie;if(/(?:^|; )${SIDEBAR_COOKIE_NAME}=false(?:;|$)/.test(c))d.setAttribute("data-sidebar-collapsed","");var w=c.match(/(?:^|; )${SIDEBAR_WIDTH_COOKIE_NAME}=(\\d+)/);d.style.setProperty("--app-loading-sidebar-width",Math.min(${SIDEBAR_MAX_WIDTH},Math.max(${SIDEBAR_MIN_WIDTH},w?+w[1]:${SIDEBAR_DEFAULT_WIDTH}))+"px")}catch(e){}`;

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html
      className={`${allo.variable} ${alloOblique.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed script with no user input, so <html lang> is right before first paint.
          dangerouslySetInnerHTML={{
            __html: HTML_LANG_FROM_COOKIE + SIDEBAR_FROM_COOKIE,
          }}
        />
        <link href={FILES_ORIGIN} rel="dns-prefetch" />
        <link href={FILES_ORIGIN} rel="preconnect" />
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
          <ShareWorkerRegistration />
        </ThemeProvider>
      </body>
    </html>
  );
}
