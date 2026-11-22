import { createFileRoute, Outlet } from "@tanstack/react-router";
import AuthenticatedAppProvider from "@/components/providers/AuthenticatedAppProvider";
import { isPageLoad, loadAppSession } from "@/lib/appSession";

// Signed-in pages that fill the window without the sidebar, such as
// `/open/<cardId>`. While the session loads they show an empty page, not the
// app shell, so a redirect straight on to another site shows nothing.
const quietPage = <div className="min-h-dvh bg-background" />;

export const Route = createFileRoute("/_standalone")({
  loader: ({ location }) =>
    loadAppSession({
      data: { pageLoad: isPageLoad(), path: location.href, seeds: false },
    }),
  shouldReload: false,
  pendingComponent: () => quietPage,
  component: StandaloneLayout,
});

function StandaloneLayout() {
  return (
    <AuthenticatedAppProvider
      loading={quietPage}
      session={Route.useLoaderData()}
    >
      <Outlet />
    </AuthenticatedAppProvider>
  );
}
