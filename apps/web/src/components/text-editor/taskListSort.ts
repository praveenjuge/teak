import { Extension } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import {
  AttrStep,
  type Mappable,
  Mapping,
  ReplaceAroundStep,
} from "@tiptap/pm/transform";
import type { EditorView } from "@tiptap/pm/view";

const TASK_ITEM = "taskItem";
const TASK_LIST = "taskList";

export const TASK_SLIDE_MS = 220;

interface TaskMove {
  first: number;
  last: number;
  listPos: number;
  order: number[];
}

const taskListSortKey = new PluginKey<TaskMove | null>("teakTaskListSort");

function findToggledTaskItem(tr: Transaction): number | null {
  let found: number | null = null;
  for (let index = 0; index < tr.steps.length; index++) {
    const step = tr.steps[index];
    const before = tr.docs[index];
    let from: number | null = null;
    if (step instanceof AttrStep && step.attr === "checked") {
      from = step.pos;
    } else if (step instanceof ReplaceAroundStep) {
      const node = before.nodeAt(step.from);
      if (node && step.to - step.from === node.nodeSize) {
        from = step.from;
      }
    }
    if (from === null) {
      continue;
    }
    const old = before.nodeAt(from);
    const after = index + 1 < tr.docs.length ? tr.docs[index + 1] : tr.doc;
    const next = after.nodeAt(from);
    if (
      old?.type.name !== TASK_ITEM ||
      next?.type.name !== TASK_ITEM ||
      old.attrs.checked === next.attrs.checked ||
      !old.content.eq(next.content)
    ) {
      continue;
    }
    if (found !== null) {
      return null;
    }
    found = tr.mapping.slice(index + 1).map(from);
  }
  return found;
}

export function sortedTaskOrder(
  checked: readonly boolean[],
  index: number
): number[] {
  const others = checked.map((_, at) => at).filter((at) => at !== index);
  let target = 0;
  for (const [position, at] of others.entries()) {
    if (!checked[at]) {
      target = position + 1;
    }
  }
  return [...others.slice(0, target), index, ...others.slice(target)];
}

export function moveToggledTaskItem(
  state: EditorState,
  tr: Transaction,
  later?: Mappable
): Transaction | null {
  if (
    !tr.docChanged ||
    tr.getMeta("teakExternalSync") ||
    tr.getMeta("uiEvent") === "paste" ||
    tr.getMeta("uiEvent") === "drop" ||
    isHistoryTransaction(tr)
  ) {
    return null;
  }
  const toggled = findToggledTaskItem(tr);
  if (toggled === null) {
    return null;
  }
  const itemPos = later ? later.map(toggled) : toggled;
  if (state.doc.nodeAt(itemPos)?.type.name !== TASK_ITEM) {
    return null;
  }
  const $item = state.doc.resolve(itemPos);
  const list = $item.parent;
  if (list.type.name !== TASK_LIST || list.childCount < 2) {
    return null;
  }
  const index = $item.index();
  const items: readonly ProseMirrorNode[] = list.content.content;
  const order = sortedTaskOrder(
    items.map((item) => Boolean(item.attrs.checked)),
    index
  );
  const newIndex = order.indexOf(index);
  if (newIndex === index) {
    return null;
  }
  const first = Math.min(index, newIndex);
  const last = Math.max(index, newIndex);
  const rangeOf = (start: number, end: number) =>
    Array.from({ length: end - start }, (_, offset) => start + offset);
  const sizeOf = (indexes: number[]) =>
    indexes.reduce((size, at) => size + items[at].nodeSize, 0);
  const from = $item.start() + sizeOf(order.slice(0, first));
  const to = from + sizeOf(order.slice(first, last + 1));
  const move = state.tr.replaceWith(
    from,
    to,
    Fragment.fromArray(order.slice(first, last + 1).map((at) => items[at]))
  );

  // The replace maps any position inside the run to its edge, so a text
  // selection inside one of its items (the ticked one, or a sibling the
  // caret sat in while a checkbox was clicked) moves with that item.
  const { anchor, head } = state.selection;
  const ownerOf = (pos: number) => {
    let start = from;
    for (let at = first; at <= last; at++) {
      if (pos > start && pos < start + items[at].nodeSize) {
        return at;
      }
      start += items[at].nodeSize;
    }
    return null;
  };
  const owner = ownerOf(anchor);
  if (
    state.selection instanceof TextSelection &&
    owner !== null &&
    owner === ownerOf(head)
  ) {
    const oldStart = from + sizeOf(rangeOf(first, owner));
    const newStart = from + sizeOf(order.slice(first, order.indexOf(owner)));
    const shift = newStart - oldStart;
    move.setSelection(
      TextSelection.create(move.doc, anchor + shift, head + shift)
    );
  }
  if (tr.getMeta("addToHistory") === false) {
    move.setMeta("addToHistory", false);
  }
  const taskMove: TaskMove = { listPos: $item.before(), first, last, order };
  return move.setMeta(taskListSortKey, taskMove);
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function itemElements(view: EditorView, pos: number): HTMLElement[] | null {
  const list = view.nodeDOM(pos);
  if (!(list instanceof HTMLElement)) {
    return null;
  }
  return Array.from(list.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
}

function slide(elements: HTMLElement[], before: number[], move: TaskMove) {
  for (let at = move.first; at <= move.last; at++) {
    const element = elements[at];
    const was = before[move.order[at]];
    if (
      !element ||
      was === undefined ||
      typeof element.animate !== "function"
    ) {
      continue;
    }
    for (const running of element.getAnimations()) {
      running.cancel();
    }
    const offset = was - element.getBoundingClientRect().top;
    if (Math.abs(offset) < 0.5) {
      continue;
    }
    element.animate(
      [{ transform: `translateY(${offset}px)` }, { transform: "none" }],
      { duration: TASK_SLIDE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" }
    );
  }
}

export function taskListSortPlugin(): Plugin {
  let editorView: EditorView | null = null;
  let pending: { move: TaskMove; before: number[] } | null = null;
  return new Plugin({
    key: taskListSortKey,
    state: {
      init: () => null,
      apply: (tr, last) => tr.getMeta(taskListSortKey) ?? last,
    },
    appendTransaction(transactions, _oldState, newState) {
      const [toggle, ...rest] = transactions;
      const later = new Mapping();
      for (const appended of rest) {
        later.appendMapping(appended.mapping);
      }
      const move = moveToggledTaskItem(newState, toggle, later);
      const taskMove = move?.getMeta(taskListSortKey) as TaskMove | undefined;
      if (taskMove && editorView && !prefersReducedMotion()) {
        const elements = itemElements(editorView, taskMove.listPos);
        if (elements?.length === taskMove.order.length) {
          pending = {
            move: taskMove,
            before: elements.map((item) => item.getBoundingClientRect().top),
          };
        }
      }
      return move;
    },
    view(view) {
      editorView = view;
      return {
        update(updated) {
          const slid = pending;
          pending = null;
          if (!slid || taskListSortKey.getState(updated.state) !== slid.move) {
            return;
          }
          const elements = itemElements(updated, slid.move.listPos);
          if (elements) {
            slide(elements, slid.before, slid.move);
          }
        },
        destroy() {
          editorView = null;
          pending = null;
        },
      };
    },
  });
}

export const TaskListSort = Extension.create({
  name: "taskListSort",
  addProseMirrorPlugins() {
    return [taskListSortPlugin()];
  },
});
