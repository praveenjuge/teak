import { createFileRoute } from "@tanstack/react-router";
import {
  handleShareAction,
  handleShareVisit,
} from "@/lib/share/shareActionRoute";

// The share sheet's POST target (the manifest's share_target). It stays
// outside sign-in: a sign-in redirect would drop the POST, and it only
// redirects on to the library, which then asks for sign-in.
export const Route = createFileRoute("/share")({
  server: {
    handlers: {
      POST: ({ request }) => handleShareAction(request),
      GET: ({ request }) => handleShareVisit(request),
    },
  },
});
