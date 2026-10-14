"use client";

import { Suspense, useRef, useState } from "react";
import { lazyWithPreload } from "../../lib/lazyWithPreload";
import { EditorFieldset, MarkdownStandIn } from "./MarkdownStandIn";
import type { MarkdownTextEditorProps } from "./types";

// The rich editor (Tiptap, ProseMirror, the block editor and its styles) is
// the largest part of the app's code, so it loads after the page instead of
// with it. Until it arrives, a plain textarea edits the same Markdown string.
const LoadedMarkdownTextEditor = lazyWithPreload(() =>
  import("./LoadedMarkdownTextEditor").then((module) => module.default)
);

/** Starts loading the rich editor before any editor renders. */
export const preloadMarkdownTextEditor = LoadedMarkdownTextEditor.preload;

export function MarkdownTextEditor(props: MarkdownTextEditorProps) {
  // Whether the stand-in has focus, read when the rich editor mounts so it
  // takes over the caret instead of dropping it mid-sentence.
  const standInFocus = useRef(false);
  // Kept for this editor's life: switching from the lazy component to the
  // loaded one later would remount the editor under the cursor.
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
