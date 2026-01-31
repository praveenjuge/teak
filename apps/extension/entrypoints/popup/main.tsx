import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "../../style.css";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { ConvexReactClient } from "convex/react";
import { authClient } from "../../lib/auth-client";

const convex = new ConvexReactClient(import.meta.env.VITE_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
  expectAuth: true,
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConvexBetterAuthProvider authClient={authClient} client={convex}>
      <App />
    </ConvexBetterAuthProvider>
  </React.StrictMode>
);
