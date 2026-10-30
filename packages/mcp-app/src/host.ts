import type { HostBridge, HostContext } from "./bridge";

/** Applies the host's theme, style variables and fonts to the document. */
export const applyHostContext = (context: HostContext | undefined) => {
  const root = document.documentElement;
  if (context?.theme) {
    root.dataset.theme = context.theme;
    root.style.colorScheme = context.theme;
  }
  for (const [name, value] of Object.entries(
    context?.styles?.variables ?? {}
  )) {
    if (name.startsWith("--") && typeof value === "string") {
      root.style.setProperty(name, value);
    }
  }
  const fonts = context?.styles?.css?.fonts;
  if (fonts && !document.getElementById("host-fonts")) {
    const style = document.createElement("style");
    style.id = "host-fonts";
    style.textContent = fonts;
    document.head.append(style);
  }
};

/** Reports the document's height to the host whenever it changes. */
export const reportSize = (bridge: HostBridge) => {
  let width = 0;
  let height = 0;
  let queued = false;
  const measure = () => {
    if (queued) {
      return;
    }
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const root = document.documentElement;
      const previous = root.style.height;
      root.style.height = "max-content";
      const nextHeight = Math.ceil(root.getBoundingClientRect().height);
      root.style.height = previous;
      const nextWidth = Math.ceil(window.innerWidth);
      if (nextWidth !== width || nextHeight !== height) {
        width = nextWidth;
        height = nextHeight;
        bridge.sendSizeChanged({ height, width });
      }
    });
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(document.documentElement);
  observer.observe(document.body);
};
