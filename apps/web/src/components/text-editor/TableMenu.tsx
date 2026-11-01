import { autoUpdate } from "@floating-ui/dom";
import { useTranslations } from "@teak/i18n/react";
import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import { Ellipsis } from "vadivam-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  cursorIntoTableElement,
  type TableAction,
  tableActions,
  tableAt,
  withTableAction,
} from "./tableEditing";

const BUTTON_SIZE = 28;
/** The gap between the button and the table's top edge, which it sits above
 * so it never covers a cell's text; editor.css leaves room for it there. */
const GAP = 4;

const tableElement = (editor: Editor, pos: number): HTMLElement | null => {
  const dom = editor.view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom : null;
};

export function TableMenu({ editor }: { editor: Editor }) {
  const t = useTranslations("textEditor");
  const [focusedTable, setFocusedTable] = useState<HTMLElement | null>(null);
  const [hoveredTable, setHoveredTable] = useState<HTMLElement | null>(null);
  const [overButton, setOverButton] = useState(false);
  const [buttonFocused, setButtonFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [, setRevision] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const lastTable = useRef<HTMLElement | null>(null);
  const current = focusedTable ?? hoveredTable;
  if (current) {
    lastTable.current = current;
  }
  const anchor =
    current ?? (open || overButton || buttonFocused ? lastTable.current : null);

  useEffect(() => {
    // A hidden <Activity> unmounts the editor's view while this effect's
    // cleanup is still pending, and reconnects the effect against that
    // unmounted editor before a new one arrives. Reading `editor.view` then
    // throws, so skip an unmounted editor and keep the DOM node for cleanup.
    if (editor.isDestroyed) {
      return;
    }
    const dom = editor.view.dom;
    const update = () => {
      const table = tableAt(editor.state);
      setFocusedTable(
        table && editor.isFocused ? tableElement(editor, table.pos) : null
      );
      setRevision((value) => value + 1);
    };
    const onPointerOver = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      setHoveredTable(
        (target?.closest(".tableWrapper, table") as HTMLElement | null) ?? null
      );
    };
    const onPointerLeave = () => setHoveredTable(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "F10" && tableAt(editor.state)) {
        event.preventDefault();
        button.current?.focus();
      }
    };
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    editor.on("focus", update);
    editor.on("blur", update);
    dom.addEventListener("pointerover", onPointerOver);
    dom.addEventListener("pointerleave", onPointerLeave);
    dom.addEventListener("keydown", onKeyDown);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", update);
      dom.removeEventListener("pointerover", onPointerOver);
      dom.removeEventListener("pointerleave", onPointerLeave);
      dom.removeEventListener("keydown", onKeyDown);
    };
  }, [editor]);

  useEffect(() => {
    const element = button.current;
    if (!(element && anchor)) {
      return;
    }
    // Placed against its offset parent, not the viewport: the card dialog's
    // transform would move a fixed button away from the table.
    return autoUpdate(anchor, element, () => {
      const rect = anchor.getBoundingClientRect();
      const parent = element.offsetParent;
      const base = parent?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const top =
        rect.top - base.top + (parent?.scrollTop ?? 0) - BUTTON_SIZE - GAP;
      const left =
        rect.right - base.left + (parent?.scrollLeft ?? 0) - BUTTON_SIZE;
      element.style.top = `${top}px`;
      element.style.left = `${left}px`;
    });
  }, [anchor]);

  if (!(anchor?.isConnected && editor.isEditable)) {
    return null;
  }

  const cursorIntoTable = () => {
    if (anchor) {
      cursorIntoTableElement(editor, anchor);
    }
  };
  const table = tableAt(editor.state);
  const actions = table ? tableActions(table, t) : [];
  const run = (action: TableAction) => {
    cursorIntoTable();
    withTableAction(editor.chain().focus(), action).run();
  };

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(next) => {
        if (next) {
          cursorIntoTable();
        }
        setOpen(next);
      }}
      open={open}
    >
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("table.options")}
          className="absolute z-20 size-7 rounded-md bg-background/90 text-muted-foreground shadow-xs backdrop-blur-sm hover:text-foreground"
          onBlur={() => setButtonFocused(false)}
          onFocus={() => setButtonFocused(true)}
          onPointerEnter={() => setOverButton(true)}
          onPointerLeave={() => setOverButton(false)}
          ref={button}
          size="icon"
          variant="outline"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor.commands.focus();
        }}
      >
        {actions.map((item) => (
          <TableMenuItem item={item} key={item.action} onRun={run} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TableMenuItem({
  item,
  onRun,
}: {
  item: ReturnType<typeof tableActions>[number];
  onRun: (action: TableAction) => void;
}) {
  const destructive = item.action === "deleteTable";
  return (
    <>
      {destructive ||
      item.action === "addColumnBefore" ||
      item.action === "deleteRow" ? (
        <DropdownMenuSeparator />
      ) : null}
      <DropdownMenuItem
        disabled={Boolean(item.disabled)}
        onSelect={() => onRun(item.action)}
        variant={destructive ? "destructive" : "default"}
      >
        <span className="flex flex-col">
          <span>{item.label}</span>
          {item.disabled ? (
            <span className="text-muted-foreground text-xs">
              {item.disabled}
            </span>
          ) : null}
        </span>
      </DropdownMenuItem>
    </>
  );
}
