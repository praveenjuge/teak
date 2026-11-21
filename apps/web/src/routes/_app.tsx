import { createFileRoute, Outlet } from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { AppLoadingShell } from "@/components/app-shell/AppLoadingShell";
import { AppShell } from "@/components/app-shell/AppShell";
import AuthenticatedAppProvider from "@/components/providers/AuthenticatedAppProvider";
import { loadAppSession } from "@/lib/appSession";
import { SIDEBAR_DEFAULT_WIDTH } from "@/lib/sidebarState";

// A page load renders on the server, which runs the page's first queries
// for it; a later load in the browser runs them itself.
const isPageLoad = createIsomorphicFn()
  .server(() => true)
  .client(() => false);

// The signed-in app with its sidebar. The session loads once per page load;
// `router.invalidate()` reloads it, as a language change does.
export const Route = createFileRoute("/_app")({
  loader: ({ location }) =>
    loadAppSession({
      data: { path: location.href, seeds: isPageLoad() },
    }),
  staleTime: Number.POSITIVE_INFINITY,
  shouldReload: false,
  pendingComponent: AppLoadingShell,
  component: AppLayout,
});

function AppLayout() {
  const session = Route.useLoaderData();
  const sidebar =
    "unavailable" in session
      ? { defaultOpen: true, defaultWidth: SIDEBAR_DEFAULT_WIDTH }
      : session.sidebar;
  return (
    <AuthenticatedAppProvider session={session}>
      <AppShell {...sidebar}>
        <Outlet />
      </AppShell>
    </AuthenticatedAppProvider>
  );
}
