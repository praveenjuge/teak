import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained HTML file: MCP Apps hosts render the view from the
// resource's text, so scripts and styles are inlined. Preact stands in for
// React to keep the file small; tests render with React itself.
export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true, reportCompressedSize: false },
  esbuild: { jsx: "automatic" },
  plugins: [viteSingleFile()],
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom/client": "preact/compat/client",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
    },
  },
});
