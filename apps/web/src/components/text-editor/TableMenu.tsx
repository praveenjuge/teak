import { autoUpdate } from "@floating-ui/dom";
import type { Editor } from "@tiptap/core";
import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
const INSET = 4;

/** The element ProseMirror renders for the table at `pos`. */
const tableElement = (editor: Editor, pos: number): HTMLElement | null => {
  const dom = editor.view.nodeDOM(pos);
  return dom instanceof HTMLElement ? dom : null;
};

/**
 * The ⋯ button at a table's top-right, shown while a cell has the cursor or
 * the pointer is over the table. Alt+F10 focuses it from a cell, and closing
 * its menu returns focus to the cell.
 */
export function TableMenu({ editor }: { editor: Editor }) {
  const [focusedTable, setFocusedTable] = useState<HTMLElement | null>(null);
  const [hoveredTable, setHoveredTable] = useState<HTMLElement | null>(null);
  const [overButton, setOverButton] = useState(false);
  // Alt+F10 moves focus to the button, which blurs the editor; the button
  // stays while it has focus.
  const [buttonFocused, setButtonFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [, setRevision] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  // Moving the pointer from the table onto the button, or opening the menu,
  // keeps the table the button belongs to.
  const lastTable = useRef<HTMLElement | null>(null);
  const current = focusedTable ?? hoveredTable;
  if (current) {
    lastTable.current = current;
  }
  const anchor =
    current ?? (open || overButton || buttonFocused ? lastTable.current : null);

  useEffect(() => {
    const update = () => {
      const table = tableAt(editor.state);
      setFocusedTable(
        table && editor.isFocused ? tableElement(editor, table.pos) : null
      );
      setRevision((value) => value + 1);
    };
    const view = editor.view;
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
    view.dom.addEventListener("pointerover", onPointerOver);
    view.dom.addEventListener("pointerleave", onPointerLeave);
    view.dom.addEventListener("keydown", onKeyDown);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
      editor.off("focus", update);
      editor.off("blur", update);
      view.dom.removeEventListener("pointerover", onPointerOver);
      view.dom.removeEventListener("pointerleave", onPointerLeave);
      view.dom.removeEventListener("keydown", onKeyDown);
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
      const top = rect.top - base.top + (parent?.scrollTop ?? 0) + INSET;
      const left =
        rect.right -
        base.left +
        (parent?.scrollLeft ?? 0) -
        BUTTON_SIZE -
        INSET;
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
  const actions = table ? tableActions(table) : [];
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
          aria-label="Table options"
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
