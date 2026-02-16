import { ConvexProviderWithAuth } from "convex/react";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "./components/ui/sonner";
import { convex } from "./lib/convex-client";
import { useDesktopConvexAuth } from "./lib/desktop-auth";
import "antd/dist/reset.css";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConvexProviderWithAuth client={convex} useAuth={useDesktopConvexAuth}>
      <ConvexQueryCacheProvider>
        <App />
      </ConvexQueryCacheProvider>
    </ConvexProviderWithAuth>
    <Toaster position="bottom-center" />
  </React.StrictMode>
);
