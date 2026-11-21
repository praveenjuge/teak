import { createFileRoute } from "@tanstack/react-router";
import { startWorkosAuth } from "@/server/authStart";

// WorkOS Initiate login URI. AuthKit sends sign-ins that did not start here
// (password reset and invitation emails, bookmarks) to this route, which must
// start a fresh AuthKit sign-in so the PKCE cookie and state are bound here.
export const Route = createFileRoute("/sign-in")({
  server: {
    handlers: { GET: ({ request }) => startWorkosAuth(request, "sign-in") },
  },
});
