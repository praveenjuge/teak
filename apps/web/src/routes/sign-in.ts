import { createFileRoute } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";

export const Route = createFileRoute("/sign-in")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const next = new URL(request.url).searchParams.get("next");
        const url = await getSignInUrl(
          next?.startsWith("/") ? { data: { returnPathname: next } } : undefined
        );
        return new Response(null, { status: 303, headers: { Location: url } });
      },
    },
  },
});
