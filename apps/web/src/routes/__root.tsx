import { Outlet, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <>
      <main className="max-w-7xl mx-auto px-4">
        <Outlet />
      </main>
      <TanStackRouterDevtools />
    </>
  );
}
