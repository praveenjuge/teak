import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppLoadingShell } from "@/components/app-shell/AppLoadingShell";
import { AppShell } from "@/components/app-shell/AppShell";
import AuthenticatedAppProvider from "@/components/providers/AuthenticatedAppProvider";
import { loadAppSession } from "@/lib/appSession";
import { SIDEBAR_DEFAULT_WIDTH } from "@/lib/sidebarState";

// The signed-in app with its sidebar. The session loads once per page load;
// `router.invalidate()` reloads it, as a language change does.
export const Route = createFileRoute("/_app")({
  loader: ({ location }) =>
    loadAppSession({
      data: { path: location.href, seeds: typeof document === "undefined" },
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
