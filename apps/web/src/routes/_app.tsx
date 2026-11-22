import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppLoadingShell } from "@/components/app-shell/AppLoadingShell";
import { AppShell } from "@/components/app-shell/AppShell";
import AuthenticatedAppProvider from "@/components/providers/AuthenticatedAppProvider";
import { validateAppSearch } from "@/lib/appSearch";
import { isPageLoad, loadAppSession } from "@/lib/appSession";
import { SIDEBAR_DEFAULT_WIDTH } from "@/lib/sidebarState";

// The signed-in app with its sidebar. The session loads once per page load;
// `router.invalidate()` reloads it, as a language change does.
export const Route = createFileRoute("/_app")({
  validateSearch: validateAppSearch,
  loader: ({ location }) =>
    loadAppSession({
      data: {
        pageLoad: isPageLoad(),
        path: location.href,
        // A page load renders on the server, which runs the page's first
        // queries for it; a later load in the browser runs them itself.
        seeds: isPageLoad(),
      },
    }),
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
