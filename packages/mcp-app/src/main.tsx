import { StrictMode, useEffect, useMemo, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { HostBridge } from "./bridge";
import { loadAppMessages } from "./catalogs";
import { applyHostContext, reportSize } from "./host";
import { createAppTranslator, resolveAppLocale } from "./i18n";
import { type CardView, viewFromToolResult } from "./model";
import { TeakView } from "./views";
import "./styles.css";

// What the host has sent so far. The host may answer before React renders,
// so the view reads this store rather than waiting on callbacks.
let state: { hostLocale: string | undefined; view: CardView } = {
  hostLocale: navigator.language,
  view: { kind: "loading" },
};
const listeners = new Set<() => void>();
const update = (next: Partial<typeof state>) => {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

let toolInput: Record<string, unknown> | undefined;

const bridge = new HostBridge(window.parent, window, {
  onHostContextChanged: (context) => {
    applyHostContext(context);
    if (context.locale) {
      update({ hostLocale: context.locale });
    }
  },
  onToolCancelled: () => update({ view: { kind: "error" } }),
  onToolInput: (input) => {
    toolInput = input;
  },
  onToolResult: (result) =>
    update({
      view: viewFromToolResult({
        input: toolInput,
        result,
        toolName: bridge.hostContext?.toolInfo?.tool?.name,
      }),
    }),
});

const Root = () => {
  const { hostLocale, view } = useSyncExternalStore(subscribe, () => state);
  const locale = resolveAppLocale(hostLocale);
  const messages = useMemo(() => loadAppMessages(locale), [locale]);
  const t = useMemo(
    () => createAppTranslator(locale, messages),
    [locale, messages]
  );
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <TeakView
      messages={messages}
      onOpen={(url) => {
        bridge.openLink(url).catch(() => undefined);
      }}
      t={t}
      view={view}
    />
  );
};

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Root />
    </StrictMode>
  );
}

bridge
  .connect({ name: "Teak", version: "1.0.0" })
  .then((context) => {
    applyHostContext(context);
    if (context?.locale) {
      update({ hostLocale: context.locale });
    }
    reportSize(bridge);
  })
  .catch(() => update({ view: { kind: "error" } }));
