"use client";

import "@editorcn/block-editor/style.css";
import "./editor.css";

import type { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";
import { useLayoutEffect, useRef, useState } from "react";
import {
  EditorFieldset,
  MarkdownStandIn,
  type StandInFocus,
} from "./MarkdownStandIn";
import { RichMarkdownEditor } from "./RichMarkdownEditor";
import type { MarkdownTextEditorProps } from "./types";

export default function LoadedMarkdownTextEditor({
  standInFocus,
  ...props
}: MarkdownTextEditorProps & {
  /** Set while the stand-in has focus. */
  standInFocus?: StandInFocus;
}) {
  // Someone is typing in the stand-in as this code arrives. Focus moves to a
  // stand-in here, then to the editor once Tiptap has made it, each within
  // one commit: a keystroke never lands on the page in between and is lost.
  const [handOver] = useState(() => Boolean(standInFocus?.current));
  const [editor, setEditor] = useState<Editor | null>(null);
  const standIn = useRef<HTMLTextAreaElement>(null);
  const showStandIn = handOver && !editor;

  useLayoutEffect(() => {
    const textarea = standIn.current;
    if (handOver && textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }, [handOver]);

  useLayoutEffect(() => {
    if (handOver && editor) {
      // Focus now: Tiptap's focus command waits a frame, and a keystroke in
      // that frame would land on the page.
      const { state, view } = editor;
      view.dispatch(state.tr.setSelection(Selection.atEnd(state.doc)));
      view.focus();
    }
  }, [editor, handOver]);

  return (
    <EditorFieldset {...props}>
      {showStandIn && standInFocus && (
        <MarkdownStandIn {...props} focus={standInFocus} ref={standIn} />
      )}
      <div className={showStandIn ? "hidden" : "contents"}>
        <RichMarkdownEditor
          {...props}
          autoFocus={props.autoFocus && !handOver}
          onEditorReady={setEditor}
        />
      </div>
    </EditorFieldset>
  );
}
