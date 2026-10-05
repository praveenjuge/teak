import type { PublicAuthMode } from "@teak/convex/auth";

export type { PublicAuthMode } from "@teak/convex/auth";

export function validateAuthMode(value: unknown): PublicAuthMode {
  if (!value || typeof value !== "object") {
    throw new Error("Authentication is unavailable.");
  }
  const mode = value as Record<string, unknown>;
  if (
    (mode.primary !== "betterauth" && mode.primary !== "workos") ||
    typeof mode.signupsDisabled !== "boolean" ||
    typeof mode.accountChangesPaused !== "boolean" ||
    (mode.authKitClientId !== undefined &&
      (typeof mode.authKitClientId !== "string" ||
        !/^client_[A-Za-z0-9]+$/.test(mode.authKitClientId))) ||
    (mode.primary === "workos" && !mode.authKitClientId)
  ) {
    throw new Error("Authentication is unavailable.");
  }
  return mode as unknown as PublicAuthMode;
}

export function sameAuthProvider(
  a: PublicAuthMode,
  b: PublicAuthMode
): boolean {
  return a.primary === b.primary && a.authKitClientId === b.authKitClientId;
}

export function assertWorkosCallbackBinding(
  state: string | undefined,
  current: PublicAuthMode,
  clientId: string
): void {
  let binding: unknown = null;
  try {
    binding = state ? JSON.parse(state) : null;
  } catch {
    binding = null;
  }
  if (
    current.primary !== "workos" ||
    current.authKitClientId !== clientId ||
    !binding ||
    typeof binding !== "object" ||
    !("primary" in binding && binding.primary === "workos") ||
    !("clientId" in binding && binding.clientId === clientId)
  ) {
    throw new Error("Sign-in changed. Please start again.");
  }
}

export function inactiveAuthProvider(): Response {
  return Response.json(
    { error: "inactive_provider", message: "Restart sign-in from your app." },
    { status: 409, headers: { "Cache-Control": "no-store" } }
  );
}
