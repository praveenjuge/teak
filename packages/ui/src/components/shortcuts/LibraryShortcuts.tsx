"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  type KeyboardShortcut,
  useKeyboardShortcuts,
} from "../../hooks/useKeyboardShortcuts";
import {
  focusLibrarySearch,
  focusNewNoteComposer,
  GO_TO_VIEW_KEYS,
  pressUploadFiles,
  requestNewNoteComposerFocus,
} from "../../lib/keyboardShortcuts";
import { LIBRARY_VIEWS, type LibraryView } from "../../lib/libraryViews";
import { KeyboardShortcutsDialog } from "../modals/KeyboardShortcutsDialog";

interface LibraryShortcutsProps {
  /** Opens a library view (`g` then a letter, or `N` away from Everything). */
  onGoToView: (view: LibraryView) => void;
}

/**
 * The app's keyboard shortcuts that work on every page: `/` search, `N` new
 * note, `U` upload, `g` then a letter to go to a view, and `?` for the list
 * of shortcuts. Card shortcuts belong to the grid.
 */
export function LibraryShortcuts({ onGoToView }: LibraryShortcutsProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const isDialogOpenRef = useRef(false);
  const setDialogOpen = useCallback((open: boolean) => {
    isDialogOpenRef.current = open;
    setIsDialogOpen(open);
  }, []);
  // A shortcut pressed in the list closes it first and runs once it has
  // closed: while the dialog's focus trap is up, moving focus (to the
  // search box, say) would be pulled back into it.
  const afterCloseRef = useRef<(() => void) | null>(null);

  const shortcuts = useMemo<KeyboardShortcut[]>(() => {
    const closeDialogThen = (action: () => void) => () => {
      if (isDialogOpenRef.current) {
        afterCloseRef.current = action;
        setDialogOpen(false);
        return;
      }
      action();
    };
    return [
      {
        keys: "/",
        run: closeDialogThen(() => {
          focusLibrarySearch();
        }),
      },
      {
        keys: "n",
        run: closeDialogThen(() => {
          if (!focusNewNoteComposer()) {
            // Only Everything has the composer: open it, then focus it.
            requestNewNoteComposerFocus();
            onGoToView("all");
          }
        }),
      },
      {
        keys: "u",
        run: closeDialogThen(() => {
          pressUploadFiles();
        }),
      },
      { keys: "?", run: () => setDialogOpen(!isDialogOpenRef.current) },
      ...LIBRARY_VIEWS.map((view) => ({
        keys: `g ${GO_TO_VIEW_KEYS[view]}`,
        run: closeDialogThen(() => onGoToView(view)),
      })),
    ];
  }, [onGoToView, setDialogOpen]);

  useKeyboardShortcuts(shortcuts);

  return (
    <KeyboardShortcutsDialog
      onCloseAutoFocus={(event) => {
        const action = afterCloseRef.current;
        if (action) {
          afterCloseRef.current = null;
          // The shortcut decides where focus goes, not the dialog.
          event.preventDefault();
          action();
        }
      }}
      onOpenChange={setDialogOpen}
      open={isDialogOpen}
    />
  );
}
