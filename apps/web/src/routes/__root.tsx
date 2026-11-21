import {
  createRootRoute,
  type ErrorComponentProps,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { captureClientException } from "@teak/convex/shared/clientTelemetry";
import { LOCALE_COOKIE, SUPPORTED_LOCALES } from "@teak/i18n";
import { useTranslations } from "@teak/i18n/react";
import { type ReactNode, useEffect } from "react";
import { NotFoundContent } from "@/components/feedback/NotFoundContent";
import { JsonLd } from "@/components/JsonLd";
import { CookieLocaleProvider } from "@/components/providers/CookieLocaleProvider";
import { ShareWorkerRegistration } from "@/components/providers/ShareWorkerRegistration";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { StatusScreen } from "@/components/StatusScreen";
import { Toaster } from "@/components/ui/sonner";
import { APP_BACKGROUND_COLOR } from "@/lib/appTheme";
import {
  organizationSchema,
  softwareApplicationSchema,
  websiteSchema,
} from "@/lib/jsonld";
import { pageTitle } from "@/lib/pageTitle";
import { filesOrigin } from "@/lib/public-env";
import {
  SIDEBAR_COOKIE_NAME,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_COOKIE_NAME,
} from "@/lib/sidebarState";
import alloFont from "@/styles/fonts/AlloVariableFriendly.woff2?url";
import appCss from "@/styles/globals.css?url";

const FILES_ORIGIN = filesOrigin();
const DESCRIPTION =
  "Teak is a personal knowledge hub designed to help creative minds effortlessly collect, remember, and rediscover their most important ideas and inspirations";

// The document is rendered before the signed-in layout reads the cookies, so
// it says "en"; this sets the language the cookie asks for before the first
// paint, so fonts and line breaking for Chinese, Japanese and Korean apply
// from the start.
const HTML_LANG_FROM_COOKIE = `try{var m=document.cookie.match(/(?:^|; )${LOCALE_COOKIE}=([^;]+)/);if(m&&${JSON.stringify(SUPPORTED_LOCALES)}.indexOf(m[1])>-1)document.documentElement.lang=m[1]}catch(e){}`;

// Same for the sidebar: the app's loading frame reads these to draw the
// column at the width, and in the state, people left it.
const SIDEBAR_FROM_COOKIE = `try{var d=document.documentElement,c=document.cookie;if(/(?:^|; )${SIDEBAR_COOKIE_NAME}=false(?:;|$)/.test(c))d.setAttribute("data-sidebar-collapsed","");var w=c.match(/(?:^|; )${SIDEBAR_WIDTH_COOKIE_NAME}=(\\d+)/);d.style.setProperty("--app-loading-sidebar-width",Math.min(${SIDEBAR_MAX_WIDTH},Math.max(${SIDEBAR_MIN_WIDTH},w?+w[1]:${SIDEBAR_DEFAULT_WIDTH}))+"px")}catch(e){}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: pageTitle() },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Teak" },
      {
        property: "og:description",
        content: "A personal knowledge hub for creative minds",
      },
      { property: "og:image", content: "/opengraph-image.png" },
      { property: "og:image:width", content: "1500" },
      { property: "og:image:height", content: "788" },
      {
        property: "og:image:alt",
        content: "Teak - A personal knowledge hub for creative minds",
      },
      { name: "twitter:card", content: "summary_large_image" },
      {
        name: "theme-color",
        media: "(prefers-color-scheme: light)",
        content: APP_BACKGROUND_COLOR.light,
      },
      {
        name: "theme-color",
        media: "(prefers-color-scheme: dark)",
        content: APP_BACKGROUND_COLOR.dark,
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "preload",
        href: alloFont,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "dns-prefetch", href: FILES_ORIGIN },
      { rel: "preconnect", href: FILES_ORIGIN },
    ],
    scripts: [{ children: HTML_LANG_FROM_COOKIE + SIDEBAR_FROM_COOKIE }],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: NotFound,
  errorComponent: RootError,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
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
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}

// Unmatched URLs render inside the document, so the page follows the theme
// the person picked. The tab title stays English: the page renders before
// the language is known.
function NotFound() {
  return (
    <main className="fixed inset-0 grid place-items-center p-6">
      <title>{pageTitle("Page not found")}</title>
      <CookieLocaleProvider>
        <NotFoundContent />
      </CookieLocaleProvider>
    </main>
  );
}

function RootErrorScreen({ retry }: { retry: () => void }) {
  const t = useTranslations();
  return (
    <StatusScreen
      action={t("common.tryAgain")}
      message={t("app.globalError.message")}
      onAction={retry}
    />
  );
}

function RootError({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    captureClientException(error);
  }, [error]);
  return (
    <CookieLocaleProvider>
      <RootErrorScreen retry={reset} />
    </CookieLocaleProvider>
  );
}
