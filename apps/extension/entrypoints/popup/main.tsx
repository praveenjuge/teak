import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "tailwindcss/index.css";
import {
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
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <header className="w-full">
          <SignedOut>
            <SignInButton mode="modal" />
          </SignedOut>
          <SignedIn>
            <App />
          </SignedIn>
        </header>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  </React.StrictMode>
);
