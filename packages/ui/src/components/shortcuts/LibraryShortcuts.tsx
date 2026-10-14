"use client";

import { useMemo, useRef, useState } from "react";
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
  // A shortcut pressed in the list closes it and keeps the focus it moved
  // (to the search box, say) instead of returning focus to the page.
  const keepFocusOnCloseRef = useRef(false);

  const shortcuts = useMemo<KeyboardShortcut[]>(() => {
    const closeDialogThen = (action: () => void) => () => {
      setIsDialogOpen((open) => {
        if (open) {
          keepFocusOnCloseRef.current = true;
        }
        return false;
      });
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
      { keys: "?", run: () => setIsDialogOpen((open) => !open) },
      ...LIBRARY_VIEWS.map((view) => ({
        keys: `g ${GO_TO_VIEW_KEYS[view]}`,
        run: closeDialogThen(() => onGoToView(view)),
      })),
    ];
  }, [onGoToView]);

  useKeyboardShortcuts(shortcuts);

  return (
    <KeyboardShortcutsDialog
      onCloseAutoFocus={(event) => {
        if (keepFocusOnCloseRef.current) {
          keepFocusOnCloseRef.current = false;
          event.preventDefault();
        }
      }}
      onOpenChange={setIsDialogOpen}
      open={isDialogOpen}
    />
  );
}
