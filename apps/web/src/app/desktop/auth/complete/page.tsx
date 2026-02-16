"use client";

import { useEffect } from "react";

export default function DesktopAuthCompletePage() {
  useEffect(() => {
    window.close();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
      <h1 className="font-semibold text-2xl">Login complete</h1>
      <p className="mt-3 text-muted-foreground text-sm">
        You can close this window and return to Teak.
      </p>
    </main>
  );
}
