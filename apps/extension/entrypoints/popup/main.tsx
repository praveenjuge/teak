import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "../../style.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found in popup document");
}

// Follow the system theme, like the web app's default.
const darkScheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () =>
  document.documentElement.classList.toggle("dark", darkScheme.matches);
applyTheme();
darkScheme.addEventListener("change", applyTheme);

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
