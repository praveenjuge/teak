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
  standInFocus?: StandInFocus;
}) {
  const [handOver] = useState(() => Boolean(standInFocus?.current));
  const [editor, setEditor] = useState<Editor | null>(null);
  const standIn = useRef<HTMLTextAreaElement>(null);
  const handedOver = useRef(false);
  const showStandIn = handOver && !editor;

  useLayoutEffect(() => {
    const textarea = standIn.current;
    if (handOver && textarea) {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }, [handOver]);

  useLayoutEffect(() => {
    // Once only, and never to a destroyed editor: a hidden <Activity> page
    // reruns this when it comes back, after useEditor destroyed the old one.
    if (handOver && editor && !editor.isDestroyed && !handedOver.current) {
      handedOver.current = true;
      // Focus now: Tiptap's focus command waits a frame, and a keystroke in
      // that frame would land on the page.
      const { state, view } = editor;
      view.dispatch(state.tr.setSelection(Selection.atEnd(state.doc)));
      view.focus();
    }
  }, [editor, handOver]);

  return (
    <EditorFieldset {...props}>
      {showStandIn && standInFocus ? (
        <MarkdownStandIn {...props} focus={standInFocus} ref={standIn} />
      ) : null}
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
