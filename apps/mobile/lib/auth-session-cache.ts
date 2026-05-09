import { authClient } from "@/lib/auth-client";

export async function refreshAuthSessionCache() {
  try {
    await authClient.getSession({
      fetchOptions: {
        throw: false,
      },
    });
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[auth] Unable to refresh session cache", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}
