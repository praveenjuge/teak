import {
  type ClientEventName,
  configureAnalytics,
} from "@teak/convex/shared/analytics";
import { configureClientTelemetry } from "@teak/convex/shared/clientTelemetry";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  captureExtensionEvent,
  captureExtensionException,
  reportUncaughtErrors,
} from "../../lib/telemetry";
import App from "./App.tsx";
import { LocaleRoot, loadPopupLocale } from "./LocaleRoot.tsx";
import "../../style.css";

reportUncaughtErrors(window, "popup");
configureClientTelemetry({
  captureException: (error, attributes) =>
    void captureExtensionException(error, { ...attributes, context: "popup" }),
});
configureAnalytics({
  capture: (event, properties) =>
    void captureExtensionEvent(event as ClientEventName, properties),
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in popup document");
}

const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () =>
  document.documentElement.classList.toggle("dark", darkScheme.matches);
applyTheme();
darkScheme.addEventListener("change", applyTheme);

void loadPopupLocale().then((initial) => {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <LocaleRoot initial={initial}>
        <App />
      </LocaleRoot>
    </React.StrictMode>
  );
});
