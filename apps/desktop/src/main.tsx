import { Toaster } from "@teak/ui/components/ui/sonner";
import { ConvexQueryCacheProvider } from "@teak/ui/convex-query-cache";
import { ErrorBoundary } from "@teak/ui/feedback";
import { ConvexProviderWithAuth } from "convex/react";
import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { convex } from "./lib/convex-client";
import { useDesktopConvexAuth } from "./lib/desktop-auth";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem={true}
    >
      <ConvexProviderWithAuth client={convex} useAuth={useDesktopConvexAuth}>
        <ConvexQueryCacheProvider>
          <ErrorBoundary>
            <App />
            <Toaster position="bottom-center" />
          </ErrorBoundary>
        </ConvexQueryCacheProvider>
      </ConvexProviderWithAuth>
    </ThemeProvider>
  </React.StrictMode>
);
