"use client";

import { Suspense, useRef, useState } from "react";
import { lazyWithPreload } from "../../lib/lazyWithPreload";
import { EditorFieldset, MarkdownStandIn } from "./MarkdownStandIn";
import type { MarkdownTextEditorProps } from "./types";

const LoadedMarkdownTextEditor = lazyWithPreload(() =>
  import("./LoadedMarkdownTextEditor").then((module) => module.default)
);

export const preloadMarkdownTextEditor = LoadedMarkdownTextEditor.preload;

export function MarkdownTextEditor(props: MarkdownTextEditorProps) {
  const standInFocus = useRef(false);
  const [Editor] = useState(
    () => LoadedMarkdownTextEditor.loaded() ?? LoadedMarkdownTextEditor
  );
  return (
    <Suspense
      fallback={
        <EditorFieldset {...props}>
          <MarkdownStandIn {...props} focus={standInFocus} />
        </EditorFieldset>
      }
    >
      <Editor {...props} standInFocus={standInFocus} />
    </Suspense>
  );
}
