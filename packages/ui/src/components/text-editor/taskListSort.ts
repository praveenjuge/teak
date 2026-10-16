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

const TASK_ITEM = "taskItem";
const TASK_LIST = "taskList";

/**
 * Where the task item that `tr` ticked or unticked now sits in `tr.doc`, or
 * null when `tr` toggled none, or more than one. Only a change to `checked`
 * alone counts: the checkbox's own `setNodeMarkup`, or `setNodeAttribute`.
 */
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

/**
 * The order of a task list's items once the item at `index` has been ticked
 * or unticked: it goes right after the last open item other than itself, or
 * first when there is none. Done items keep their order among themselves, so
 * the one ticked last leads the done section.
 */
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

/**
 * After a transaction that ticked or unticked one task item, a transaction
 * that moves the item (children included) among its siblings in one step, or
 * null when it already sits where it belongs. `state` is the state after
 * `tr`, and after `later`, the changes other plugins appended since, if any.
 */
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
  // Replace only the run of items between the old and the new spot.
  const first = Math.min(index, newIndex);
  const last = Math.max(index, newIndex);
  const sizeOf = (indexes: number[]) =>
    indexes.reduce((size, at) => size + items[at].nodeSize, 0);
  const from = $item.start() + sizeOf(order.slice(0, first));
  const to = from + sizeOf(order.slice(first, last + 1));
  const move = state.tr.replaceWith(
    from,
    to,
    Fragment.fromArray(order.slice(first, last + 1).map((at) => items[at]))
  );

  // A selection inside the moved item goes with it; any other maps as usual.
  const itemEnd = itemPos + items[index].nodeSize;
  const { anchor, head } = state.selection;
  const inItem = (pos: number) => pos > itemPos && pos < itemEnd;
  if (
    state.selection instanceof TextSelection &&
    inItem(anchor) &&
    inItem(head)
  ) {
    const shift = from + sizeOf(order.slice(first, newIndex)) - itemPos;
    move.setSelection(
      TextSelection.create(move.doc, anchor + shift, head + shift)
    );
  }
  if (tr.getMeta("addToHistory") === false) {
    move.setMeta("addToHistory", false);
  }
  return move;
}

const taskListSortKey = new PluginKey("teakTaskListSort");

/** Moves a ticked item below the open ones in its list, and back on untick. */
export function taskListSortPlugin(): Plugin {
  return new Plugin({
    key: taskListSortKey,
    appendTransaction(transactions, _oldState, newState) {
      // The user's change comes first; plugins may have appended others.
      const [toggle, ...rest] = transactions;
      const later = new Mapping();
      for (const appended of rest) {
        later.appendMapping(appended.mapping);
      }
      return moveToggledTaskItem(newState, toggle, later);
    },
  });
}

export const TaskListSort = Extension.create({
  name: "taskListSort",
  addProseMirrorPlugins() {
    return [taskListSortPlugin()];
  },
});
