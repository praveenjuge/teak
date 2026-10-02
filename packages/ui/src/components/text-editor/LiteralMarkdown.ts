import { Node } from "@tiptap/core";

/** Unsupported Markdown remains ordinary editable text, never parsed HTML. */
export const LiteralMarkdown = Node.create({
  name: "literalMarkdown",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  whitespace: "pre",
  parseHTML: () => [{ tag: "div[data-literal-markdown]" }],
  renderHTML: () => ["div", { "data-literal-markdown": "" }, 0],
  renderMarkdown: (node) =>
    (node.content ?? []).map((child) => child.text ?? "").join(""),
  addKeyboardShortcuts() {
    const newline = () =>
      this.editor.isEditable &&
      this.editor.isActive(this.name) &&
      this.editor.commands.insertContent({ type: "text", text: "\n" });
    return {
      Enter: newline,
      "Shift-Enter": newline,
      "Mod-a": () => {
        const { doc } = this.editor.state;
        if (!this.editor.isActive(this.name) || doc.childCount !== 1) {
          return false;
        }
        return this.editor.commands.setTextSelection({
          from: 1,
          to: doc.content.size - 1,
        });
      },
    };
  },
});
