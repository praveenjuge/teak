import { redirect } from "@tanstack/react-router";
import { createIsomorphicFn, createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestUrl } from "@tanstack/react-start/server";
import {
  LOCALE_COOKIE,
  loadMessages,
  type PartialMessages,
  type UiLocale,
} from "@teak/i18n";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import type { AuthKitProviderProps } from "@workos/authkit-tanstack-react-start/client";
import { configureWorkos } from "@/server/workos";
import { signInPath } from "./authUrls";
import type { QuerySeed } from "./firstLoadQueries";
import { fetchFirstLoadSeeds } from "./firstLoadSeeds";
import { localeFromCookie } from "./locale";
import { getSafeNextPath } from "./safe-next-path";
import {
  SIDEBAR_COOKIE_NAME,
  SIDEBAR_WIDTH_COOKIE_NAME,
  sidebarOpenFromCookie,
  sidebarWidthFromCookie,
} from "./sidebarState";

export interface AppSession {
  accessToken?: string;
  initialAuth: NonNullable<AuthKitProviderProps["initialAuth"]>;
  locale: UiLocale;
  messages: PartialMessages;
  /** A promise on a page load, rendered on the server; empty otherwise. */
  seeds: QuerySeed[] | Promise<QuerySeed[]>;
  sidebar: { defaultOpen: boolean; defaultWidth: number };
}

export type AppSessionResult = AppSession | { unavailable: true };

/**
 * Whether the router is rendering a page load on the server. A later
 * navigation runs in the browser, which calls the server for the session.
 */
export const isPageLoad = createIsomorphicFn()
  .server(() => true)
  .client(() => false);

/**
 * What every signed-in page needs from the server: the session, the person's
 * language and its messages, the sidebar they left, and, on a page load, the
 * page's first queries run with their token, so the first paint shows real
 * content. The token stays on the server apart from the one AuthKit already
 * gives the page. Without a session it redirects to sign-in.
 */
export const loadAppSession = createServerFn({ method: "GET" })
  .validator((data: { pageLoad: boolean; path: string; seeds: boolean }) => {
    // The types hold for the app's own calls; a request built by hand gets
    // checked here. The path is always the page's own, never another origin.
    const input: unknown = data;
    const { pageLoad, path, seeds } = (input ?? {}) as Partial<
      Record<string, unknown>
    >;
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.startsWith("//")
    ) {
      throw new Error("loadAppSession needs the page's path");
    }
    return { pageLoad: pageLoad === true, path, seeds: seeds === true };
  })
  .handler(async ({ data }): Promise<AppSessionResult> => {
    let auth: Awaited<ReturnType<typeof getAuth>>;
    try {
      auth = await getAuth();
    } catch {
      return { unavailable: true };
    }
    if (!auth.user) {
      // A page load goes straight to hosted AuthKit, with its PKCE cookie;
      // a client navigation can't follow that cross-origin hop, so it goes
      // through /sign-in, which starts AuthKit as a page load.
      if (data.pageLoad) {
        throw redirect({
          href: await getSignInUrl({
            data: {
              returnPathname: getSafeNextPath(data.path) ?? "/",
              redirectUri: configureWorkos().redirectUri,
            },
          }),
        });
      }
      throw redirect({ href: signInPath({ next: data.path }) });
    }
    const { accessToken, ...initialAuth } = auth;
    const locale = localeFromCookie(getCookie(LOCALE_COOKIE));
    const href = new URL(data.path, getRequestUrl()).toString();
    // Deferred: the page's head and loading frame stream at once, and its
    // content streams into the same response when the seeds answer (within
    // their budget; the promise never rejects).
    const seeds =
      data.seeds && accessToken ? fetchFirstLoadSeeds(href, accessToken) : [];
    const messages = await loadMessages(locale);
    return {
      accessToken,
      initialAuth,
      locale,
      messages,
      seeds,
      sidebar: {
        defaultOpen: sidebarOpenFromCookie(getCookie(SIDEBAR_COOKIE_NAME)),
        defaultWidth: sidebarWidthFromCookie(
          getCookie(SIDEBAR_WIDTH_COOKIE_NAME)
        ),
      },
    };
  });
