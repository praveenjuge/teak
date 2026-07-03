"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function NativeAuthCompleteContent() {
  const searchParams = useSearchParams();
  // `surface` is appended by the /native/auth/start route (the redirect_uri
  // allowlist forbids caller-supplied params), so it is trusted here.
  const isBrowserExtension =
    searchParams.get("surface") === "browser-extension";

  useEffect(() => {
    // Native surfaces open this in a browser tab; attempt to close it once the
    // handoff finishes. Browsers only allow close() for script-opened windows,
    // so the copy below is the fallback when the attempt is blocked.
    window.close();
  }, []);

  const title = isBrowserExtension ? "You're signed in" : "Login complete";
  const description = isBrowserExtension
    ? "Click the Teak icon in your browser toolbar to continue."
    : "You can close this window and return to Teak.";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
      <h1 className="font-semibold text-2xl">{title}</h1>
      <p className="mt-3 text-muted-foreground text-sm">{description}</p>
    </main>
  );
}

export default function NativeAuthCompletePage() {
  return (
    <Suspense>
      <NativeAuthCompleteContent />
    </Suspense>
  );
}
