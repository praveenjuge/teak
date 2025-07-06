import { Outlet, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <main className="px-4 pb-8 md:px-12 md:pb-12">
        <Outlet />
      </main>
      <TanStackRouterDevtools />
    </>
  );
}
