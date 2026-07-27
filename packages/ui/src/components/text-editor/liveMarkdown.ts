import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  showTooltip,
  WidgetType,
} from "@codemirror/view";
import {
  isSafeExternalUrl,
  MarkdownLinkWidget,
  parseMarkdownLink,
} from "./markdownLink";
import { MarkdownTableWidget, parseMarkdownTable } from "./markdownTable";
import { MarkdownTaskWidget } from "./markdownTask";
import type { MarkdownInlineFormat } from "./types";

export {
  copyLinkUrl,
  editLinkDestination,
  isSafeExternalUrl,
  parseMarkdownLink,
} from "./markdownLink";
export { toggleTaskMarker } from "./markdownTask";

const ACTIVE_CONSTRUCTS = new Set([
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "Blockquote",
  "Emphasis",
  "FencedCode",
  "InlineCode",
  "Link",
  "ListItem",
  "StrongEmphasis",
  "Strikethrough",
  "Table",
]);

const HIDDEN_MARKS = new Set([
  "CodeMark",
  "EmphasisMark",
  "LinkMark",
  "QuoteMark",
  "StrikethroughMark",
]);

const NON_PLAIN_URL_PARENTS = new Set(["Autolink", "Image", "Link"]);

interface SourceRange {
  from: number;
  to: number;
}

function rangesOverlap(
  first: SourceRange,
  second: SourceRange,
  includeEdges = false
) {
  if (includeEdges) {
    return first.from <= second.to && first.to >= second.from;
  }
  return first.from < second.to && first.to > second.from;
}

function selectionRanges(state: EditorState): SourceRange[] {
  return state.selection.ranges.map((range) => ({
    from: Math.min(range.anchor, range.head),
    to: Math.max(range.anchor, range.head),
  }));
}

export function activeMarkdownConstructs(state: EditorState): SourceRange[] {
  const tree = syntaxTree(state);
  const selections = selectionRanges(state);
  const active: SourceRange[] = [];

  tree.iterate({
    enter(node) {
      if (!ACTIVE_CONSTRUCTS.has(node.name)) {
        return;
      }
      const nodeRange = { from: node.from, to: node.to };
      if (
        selections.some((selection) =>
          selection.from === selection.to
            ? selection.from >= node.from && selection.from <= node.to
            : rangesOverlap(selection, nodeRange, true)
        )
      ) {
        active.push(nodeRange);
      }
    },
  });

  return active;
}

function belongsToActiveConstruct(
  active: SourceRange[],
  from: number,
  to: number
) {
  return active.some((range) => from >= range.from && to <= range.to);
}

function addBlockLineDecorations(
  state: EditorState,
  from: number,
  to: number,
  className: string,
  ranges: Range<Decoration>[]
) {
  let line = state.doc.lineAt(from);
  while (line.from <= to) {
    ranges.push(Decoration.line({ class: className }).range(line.from));
    if (line.to >= to || line.number >= state.doc.lines) {
      break;
    }
    line = state.doc.line(line.number + 1);
  }
}

class ListMarkerWidget extends WidgetType {
  readonly marker: string;

  constructor(marker: string) {
    super();
    this.marker = marker;
  }

  eq(other: ListMarkerWidget) {
    return other.marker === this.marker;
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-md-list-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = /^\d+[.)]$/u.test(this.marker) ? this.marker : "•";
    return marker;
  }
}

function codeFenceClasses(state: EditorState, from: number, to: number) {
  const ranges: Range<Decoration>[] = [];
  const firstLine = state.doc.lineAt(from);
  const lastLine = state.doc.lineAt(Math.max(from, to - 1));
  const hasClosingFence =
    lastLine.number > firstLine.number &&
    /^[ \t]*(?:`{3,}|~{3,})[ \t]*$/u.test(
      state.sliceDoc(lastLine.from, lastLine.to)
    );
  const visualLastLineNumber = hasClosingFence
    ? lastLine.number - 1
    : lastLine.number;
  let line = firstLine;

  while (line.from <= to) {
    if (hasClosingFence && line.number === lastLine.number) {
      ranges.push(
        Decoration.line({ class: "cm-md-code-fence-hidden" }).range(line.from)
      );
      break;
    }

    const classes = ["cm-md-code-line"];
    if (line.number === firstLine.number) {
      classes.push("cm-md-code-first");
    }
    if (line.number === visualLastLineNumber) {
      classes.push("cm-md-code-last");
    }
    ranges.push(Decoration.line({ class: classes.join(" ") }).range(line.from));
    if (line.number >= lastLine.number || line.number >= state.doc.lines) {
      break;
    }
    line = state.doc.line(line.number + 1);
  }
  return ranges;
}

interface MarkdownDecorationContext {
  hasFocus: boolean;
  state: EditorState;
  visibleRanges: SourceRange[];
}

export function buildMarkdownDecorations(
  view: MarkdownDecorationContext
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const active = view.hasFocus ? activeMarkdownConstructs(view.state) : [];
  const visibleFrom = view.visibleRanges[0]?.from ?? 0;
  let visibleTo = view.state.doc.length;
  for (const visibleRange of view.visibleRanges) {
    visibleTo = visibleRange.to;
  }

  syntaxTree(view.state).iterate({
    from: visibleFrom,
    to: visibleTo,
    enter(node) {
      const { from, name, to } = node;
      const source = view.state.sliceDoc(from, to);
      const isActive = belongsToActiveConstruct(active, from, to);

      if (name === "Image") {
        ranges.push(
          Decoration.mark({ class: "cm-md-image-source" }).range(from, to)
        );
        return false;
      }

      if (/^ATXHeading[1-6]$/u.test(name)) {
        ranges.push(
          Decoration.line({
            class: `cm-md-heading cm-md-heading-${name.slice(-1)}`,
          }).range(view.state.doc.lineAt(from).from)
        );
      } else if (name === "StrongEmphasis") {
        ranges.push(Decoration.mark({ class: "cm-md-strong" }).range(from, to));
      } else if (name === "Emphasis") {
        ranges.push(
          Decoration.mark({ class: "cm-md-emphasis" }).range(from, to)
        );
      } else if (name === "Strikethrough") {
        const delimiterWidth = source.startsWith("~~") ? 2 : 1;
        ranges.push(
          Decoration.mark({ class: "cm-md-strikethrough" }).range(
            from + delimiterWidth,
            to - delimiterWidth
          )
        );
      } else if (name === "InlineCode") {
        ranges.push(
          Decoration.mark({ class: "cm-md-inline-code" }).range(from, to)
        );
      } else if (name === "Blockquote") {
        addBlockLineDecorations(view.state, from, to, "cm-md-quote", ranges);
      } else if (name === "FencedCode") {
        ranges.push(...codeFenceClasses(view.state, from, to));
      } else if (name === "Comment" || name === "CommentBlock") {
        ranges.push(
          Decoration.mark({ class: "cm-md-comment" }).range(from, to)
        );
        return false;
      } else if (name === "Table" && !isActive) {
        const table = parseMarkdownTable(source);
        if (table) {
          ranges.push(
            Decoration.widget({
              block: true,
              widget: new MarkdownTableWidget(from, table),
            }).range(from),
            Decoration.replace({}).range(from, to)
          );
          return false;
        }
      } else if (name === "HorizontalRule") {
        ranges.push(
          Decoration.line({ class: "cm-md-divider" }).range(
            view.state.doc.lineAt(from).from
          )
        );
        ranges.push(
          (isActive
            ? Decoration.mark({ class: "cm-md-syntax" })
            : Decoration.replace({})
          ).range(from, to)
        );
        return false;
      }

      if (name === "Link" && !isActive) {
        const link = parseMarkdownLink(source, from);
        if (!link) {
          return;
        }
        if (!isSafeExternalUrl(link.href)) {
          ranges.push(
            Decoration.mark({ class: "cm-md-link-unsafe" }).range(from, to)
          );
          return false;
        }
        ranges.push(
          Decoration.replace({
            widget: new MarkdownLinkWidget(link),
          }).range(from, to)
        );
        return false;
      }

      if (
        name === "URL" &&
        !NON_PLAIN_URL_PARENTS.has(node.node.parent?.name ?? "") &&
        isSafeExternalUrl(source)
      ) {
        ranges.push(
          Decoration.replace({
            widget: new MarkdownLinkWidget({
              destinationFrom: from,
              destinationTo: to,
              from,
              href: source,
              label: source,
              to,
            }),
          }).range(from, to)
        );
        return false;
      }

      if (name === "HeaderMark") {
        const line = view.state.doc.lineAt(from);
        const followingWhitespace =
          from === line.from
            ? (/^[ \t]+/u.exec(view.state.sliceDoc(to, line.to))?.[0] ?? "")
            : "";
        ranges.push(
          (isActive
            ? Decoration.mark({ class: "cm-md-syntax" })
            : Decoration.replace({})
          ).range(from, isActive ? to : to + followingWhitespace.length)
        );
      } else if (name === "ListMark") {
        ranges.push(
          (isActive
            ? Decoration.mark({ class: "cm-md-syntax" })
            : Decoration.replace({
                widget: new ListMarkerWidget(source),
              })
          ).range(from, to)
        );
      } else if (name === "TaskMarker") {
        ranges.push(
          (isActive
            ? Decoration.mark({ class: "cm-md-syntax" })
            : Decoration.replace({
                widget: new MarkdownTaskWidget(
                  from,
                  source.toLowerCase() === "[x]",
                  view.state.readOnly
                ),
              })
          ).range(from, to)
        );
      } else if (name === "Task" && /^\[[xX]\]/u.test(source)) {
        ranges.push(
          Decoration.mark({ class: "cm-md-task-complete" }).range(
            Math.min(from + 4, to),
            to
          )
        );
      } else if (HIDDEN_MARKS.has(name)) {
        ranges.push(
          (isActive
            ? Decoration.mark({ class: "cm-md-syntax" })
            : Decoration.replace({})
          ).range(from, to)
        );
      }
    },
  });

  ranges.sort(
    (first, second) =>
      first.from - second.from || first.value.startSide - second.value.startSide
  );
  return Decoration.set(ranges, true);
}

const markdownFocusEffect = StateEffect.define<boolean>();

interface LiveMarkdownState {
  decorations: DecorationSet;
  hasFocus: boolean;
}

function decorationsForState(state: EditorState, hasFocus: boolean) {
  return buildMarkdownDecorations({
    hasFocus,
    state,
    visibleRanges: [{ from: 0, to: state.doc.length }],
  });
}

const liveMarkdownState = StateField.define<LiveMarkdownState>({
  create(state) {
    return {
      decorations: decorationsForState(state, false),
      hasFocus: false,
    };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
  update(value, transaction) {
    let hasFocus = value.hasFocus;
    for (const effect of transaction.effects) {
      if (effect.is(markdownFocusEffect)) {
        hasFocus = effect.value;
      }
    }
    if (
      transaction.docChanged ||
      transaction.selection ||
      transaction.startState.readOnly !== transaction.state.readOnly ||
      hasFocus !== value.hasFocus
    ) {
      return {
        decorations: decorationsForState(transaction.state, hasFocus),
        hasFocus,
      };
    }
    return {
      decorations: value.decorations.map(transaction.changes),
      hasFocus,
    };
  },
});

const liveMarkdownFocusHandlers = EditorView.domEventHandlers({
  blur(_event, view) {
    view.dispatch({ effects: markdownFocusEffect.of(false) });
    return false;
  },
  focus(_event, view) {
    view.dispatch({ effects: markdownFocusEffect.of(true) });
    return false;
  },
});

export function createLiveMarkdownPlugin(): Extension {
  return [liveMarkdownState, liveMarkdownFocusHandlers];
}

function backtickDelimiter(content: string) {
  const runs = content.match(/`+/gu) ?? [];
  const longest = Math.max(0, ...runs.map((run) => run.length));
  return "`".repeat(longest + 1);
}

function formatParts(format: MarkdownInlineFormat, content: string) {
  if (format === "bold") {
    return { prefix: "**", suffix: "**" };
  }
  if (format === "italic") {
    return { prefix: "*", suffix: "*" };
  }
  if (format === "code") {
    const delimiter = backtickDelimiter(content);
    const padding = content.startsWith("`") || content.endsWith("`") ? " " : "";
    return {
      prefix: `${delimiter}${padding}`,
      suffix: `${padding}${delimiter}`,
    };
  }
  if (format === "strikethrough") {
    return { prefix: "~~", suffix: "~~" };
  }
  return { prefix: "[", suffix: "](https://)" };
}

export function applyInlineFormat(
  view: EditorView,
  format: MarkdownInlineFormat
): boolean {
  if (view.state.readOnly) {
    return false;
  }
  const selection = view.state.selection.main;
  if (selection.empty) {
    return false;
  }

  const selected = view.state.sliceDoc(selection.from, selection.to);
  const { prefix, suffix } = formatParts(format, selected);
  const before = view.state.sliceDoc(
    Math.max(0, selection.from - prefix.length),
    selection.from
  );
  const after = view.state.sliceDoc(
    selection.to,
    Math.min(view.state.doc.length, selection.to + suffix.length)
  );

  if (format !== "link" && before === prefix && after === suffix) {
    view.dispatch({
      changes: [
        {
          from: selection.from - prefix.length,
          to: selection.from,
          insert: "",
        },
        { from: selection.to, to: selection.to + suffix.length, insert: "" },
      ],
      selection: EditorSelection.range(
        selection.from - prefix.length,
        selection.to - prefix.length
      ),
    });
    view.focus();
    return true;
  }

  const insertion = `${prefix}${selected}${suffix}`;
  const selectionAfter =
    format === "link"
      ? EditorSelection.range(
          selection.from + prefix.length + selected.length + 2,
          selection.from + insertion.length - 1
        )
      : EditorSelection.range(
          selection.from + prefix.length,
          selection.to + prefix.length
        );
  view.dispatch({
    changes: {
      from: selection.from,
      insert: insertion,
      to: selection.to,
    },
    selection: selectionAfter,
  });
  view.focus();
  return true;
}

const FORMAT_LABELS: Array<{
  format: MarkdownInlineFormat;
  glyph: string;
  label: string;
  shortcut: string;
}> = [
  { format: "bold", glyph: "B", label: "Bold", shortcut: "⌘B" },
  { format: "italic", glyph: "I", label: "Italic", shortcut: "⌘I" },
  {
    format: "strikethrough",
    glyph: "S",
    label: "Strikethrough",
    shortcut: "⌘⇧X",
  },
  { format: "link", glyph: "↗", label: "Link", shortcut: "⌘K" },
  { format: "code", glyph: "</>", label: "Code", shortcut: "⌘`" },
];

export const selectionFormatTooltip = showTooltip.compute(
  ["selection"],
  (state) => {
    const selection = state.selection.main;
    if (selection.empty) {
      return null;
    }

    return {
      above: true,
      arrow: false,
      create(view: EditorView) {
        const toolbar = document.createElement("div");
        toolbar.className = "cm-md-format-toolbar";
        toolbar.setAttribute("aria-label", "Text formatting");
        toolbar.setAttribute("role", "toolbar");

        for (const item of FORMAT_LABELS) {
          const button = document.createElement("button");
          button.className = "cm-md-format-button";
          button.type = "button";
          button.textContent = item.glyph;
          button.setAttribute("aria-label", item.label);
          button.title = `${item.label} (${item.shortcut})`;
          button.addEventListener("mousedown", (event) => {
            event.preventDefault();
            applyInlineFormat(view, item.format);
          });
          toolbar.append(button);
        }

        return { dom: toolbar };
      },
      end: selection.to,
      pos: selection.from,
    };
  }
);
