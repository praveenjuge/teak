import { Toaster } from "@teak/ui/components/ui/sonner";
import { ConvexProviderWithAuth } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { convex } from "./lib/convex-client";
import { useDesktopConvexAuth } from "./lib/desktop-auth";
import "antd/dist/reset.css";
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
          <App />
          <Toaster position="bottom-center" />
        </ConvexQueryCacheProvider>
      </ConvexProviderWithAuth>
    </ThemeProvider>
  </React.StrictMode>
);
