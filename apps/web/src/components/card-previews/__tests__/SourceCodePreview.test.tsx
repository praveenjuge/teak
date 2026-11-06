import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost:3000" });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SourceCodePreview } = await import("../FileTextPreview");

describe("source code DOM rendering", () => {
  test.each([
    "",
    " ",
    "\n",
    "\nconst value = 1;\n\n\tvalue;\n",
    "α = 1;\r\nβ = 2;\r\n",
  ])("preserves source whitespace and empty code: %j", async (code) => {
    const container = document.body.appendChild(document.createElement("div"));
    const root = createRoot(container);
    try {
      await act(() => {
        root.render(<SourceCodePreview code={code} language="typescript" />);
        return Promise.resolve();
      });
      expect(container.querySelector("pre code")?.textContent).toBe(code);
      expect(
        container.querySelector("pre")?.hasAttribute("data-not-typeset")
      ).toBe(true);
    } finally {
      await act(() => {
        root.unmount();
        return Promise.resolve();
      });
      container.remove();
    }
  });
});
