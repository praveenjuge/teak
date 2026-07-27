import { Transaction } from "@codemirror/state";
import { type EditorView, WidgetType } from "@codemirror/view";

export function toggleTaskMarker(view: EditorView, markerFrom: number) {
  if (view.state.readOnly) {
    return false;
  }
  const marker = view.state.sliceDoc(markerFrom, markerFrom + 3);
  if (!/^\[[ xX]\]$/u.test(marker)) {
    return false;
  }
  view.dispatch({
    annotations: Transaction.userEvent.of("input"),
    changes: {
      from: markerFrom + 1,
      insert: marker === "[ ]" ? "x" : " ",
      to: markerFrom + 2,
    },
  });
  return true;
}

export class MarkdownTaskWidget extends WidgetType {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly from: number;

  constructor(from: number, checked: boolean, disabled: boolean) {
    super();
    this.from = from;
    this.checked = checked;
    this.disabled = disabled;
  }

  eq(other: MarkdownTaskWidget) {
    return (
      other.from === this.from &&
      other.checked === this.checked &&
      other.disabled === this.disabled
    );
  }

  toDOM(view: EditorView) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "cm-md-task-checkbox";
    checkbox.checked = this.checked;
    checkbox.disabled = this.disabled;
    checkbox.setAttribute(
      "aria-label",
      this.checked ? "Mark task incomplete" : "Mark task complete"
    );
    checkbox.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    checkbox.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleTaskMarker(view, this.from);
    });
    return checkbox;
  }

  ignoreEvent() {
    return true;
  }
}
