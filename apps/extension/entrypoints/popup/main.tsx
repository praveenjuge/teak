import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "../../style.css";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { authClient } from "../../lib/auth-client";

const convexUrl = import.meta.env.VITE_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("VITE_PUBLIC_CONVEX_URL environment variable is not set");
}

const convex = new ConvexReactClient(convexUrl, {
  unsavedChangesWarning: false,
  expectAuth: true,
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in popup document");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ConvexBetterAuthProvider authClient={authClient} client={convex}>
      <App />
    </ConvexBetterAuthProvider>
  </React.StrictMode>
);
