// The browser extension keeps its own small copy of the web app's theme
// tokens (architecture.mdx, "Rules every change keeps"). This checks the copy
// against the original, so a color changed on the web reaches the extension.
import { expect, test } from "bun:test";
import { resolve } from "node:path";

const EXTENSION_CSS = resolve(
  import.meta.dir,
  "../../apps/extension/style.css"
);
const WEB_THEME_CSS = resolve(
  import.meta.dir,
  "../../apps/web/src/styles/theme.css"
);

/** The custom properties a top-level `:root` or `.dark` block declares. */
const tokens = (css: string, selector: ":root" | ".dark") => {
  const values: Record<string, string> = {};
  const blocks = css.matchAll(
    new RegExp(`^${selector.replace(".", "\\.")} \\{\\n([\\s\\S]*?)^\\}`, "gm")
  );
  for (const [, body] of blocks) {
    for (const [, name, value] of (body ?? "").matchAll(
      /^\s*(--[\w-]+):\s*([^;]+);/gm
    )) {
      values[name as string] = (value as string).trim();
    }
  }
  return values;
};

test.each([":root", ".dark"] as const)(
  "the extension's %s tokens match the web app's",
  async (selector) => {
    const extension = tokens(await Bun.file(EXTENSION_CSS).text(), selector);
    const web = tokens(await Bun.file(WEB_THEME_CSS).text(), selector);
    expect(Object.keys(extension).length).toBeGreaterThan(10);
    for (const [name, value] of Object.entries(extension)) {
      expect({ name, value }).toEqual({ name, value: web[name] as string });
    }
  }
);
