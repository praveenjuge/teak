import { authClient } from "@/lib/auth-client";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(auth)")({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (session?.user) {
      throw redirect({
        to: "/",
      });
    }
  },
});
