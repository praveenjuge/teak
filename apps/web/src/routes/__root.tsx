import { Outlet, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/router-devtools";
import { Header } from "@/components/Header";
import { authClient } from "@/lib/auth-client";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const { data: session, isPending } = authClient.useSession();

  return (
    <>
      {!isPending && session?.user && <Header />}

      <main className="flex-1">
        <Outlet />
      </main>

      <TanStackRouterDevtools />
    </>
  );
}
