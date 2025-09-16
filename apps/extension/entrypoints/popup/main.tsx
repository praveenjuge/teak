import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "../../style.css";

import { Loader2 } from "lucide-react";
import {
  ClerkLoading,
  ClerkProvider,
  SignInButton,
  SignedIn,
  SignedOut,
  useAuth,
} from "@clerk/chrome-extension";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ConvexReactClient } from "convex/react";

const PUBLISHABLE_KEY = import.meta.env.VITE_PUBLIC_CLERK_PUBLISHABLE_KEY;
const EXTENSION_URL = chrome.runtime.getURL(".");
const convex = new ConvexReactClient(import.meta.env.VITE_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

if (!PUBLISHABLE_KEY) {
  throw new Error(
    "Please add the VITE_PUBLIC_CLERK_PUBLISHABLE_KEY to the .env.local or .env.chrome file"
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl={`${EXTENSION_URL}/popup.html`}
      signInFallbackRedirectUrl={`${EXTENSION_URL}/popup.html`}
      signUpFallbackRedirectUrl={`${EXTENSION_URL}/popup.html`}
      appearance={{
        variables: {
          colorPrimary: "oklch(0.58 0.22 27)",
        },
        elements: {
          cardBox: "!w-full !shadow-none",
        },
      }}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ClerkLoading>
          <div className="size-96 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-red-600 animate-spin" />
          </div>
        </ClerkLoading>
        <SignedOut>
          <div className="size-96 flex items-center flex-col justify-center p-4 text-center gap-4">
            <img src="./icon.svg" alt="Teak Logo" className="h-6" />
            <div className="space-y-1">
              <h1 className="text-base font-semibold">
                Save Anything. Anywhere.
              </h1>
              <p className="text-sm text-gray-500 text-balance">
                Your personal everything management system. Organize, save, and
                access all your text, images, and documents in one place.
              </p>
            </div>
            <SignInButton mode="modal">
              <button className="rounded px-5 py-2 text-sm font-medium bg-red-600 text-white cursor-pointer">
                Sign In
              </button>
            </SignInButton>
          </div>
        </SignedOut>
        <SignedIn>
          <App />
        </SignedIn>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </React.StrictMode>
);
