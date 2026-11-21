import { createFileRoute } from "@tanstack/react-router";
import { startWorkosAuth } from "@/server/authStart";

export const Route = createFileRoute("/sign-up")({
  server: {
    handlers: { GET: ({ request }) => startWorkosAuth(request, "sign-up") },
  },
});
