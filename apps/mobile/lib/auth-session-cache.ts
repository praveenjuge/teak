import { authClient } from "@/lib/auth-client";

export async function refreshAuthSessionCache() {
  try {
    const result = await authClient.getSession({
      fetchOptions: {
        throw: false,
      },
    });
    return Boolean(result.data?.user);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[auth] Unable to refresh session cache", {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
    return false;
  }
}
