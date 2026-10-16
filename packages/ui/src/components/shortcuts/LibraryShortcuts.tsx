"use client";

import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type KeyboardShortcut,
  useKeyboardShortcuts,
} from "../../hooks/useKeyboardShortcuts";
import {
  isCommandPaletteKey,
  paletteCardHref,
  paletteSearchAllHref,
  paletteShuffleHref,
  settingsDialogHref,
  shouldOpenPalette,
} from "../../lib/commandPalette";
import {
  focusLibrarySearch,
  focusNewNoteComposer,
  GO_TO_VIEW_KEYS,
  pressUploadFiles,
  requestNewNoteComposerFocus,
} from "../../lib/keyboardShortcuts";
import { LIBRARY_VIEWS, type LibraryView } from "../../lib/libraryViews";
import {
  CommandPalette,
  type CommandPaletteCommand,
} from "../command-palette/CommandPalette";
import { KeyboardShortcutsDialog } from "../modals/KeyboardShortcutsDialog";

interface LibraryShortcutsProps {
  /** Opens a library view (`g` then a letter, or `N` away from Everything). */
  onGoToView: (view: LibraryView) => void;
  /** Goes to an app URL, such as a folder or `/?card=…`. */
  onNavigate: (href: string) => void;
  onSignOut: () => void;
  /** The current page, so a chosen card opens over it when it can. */
  pathname: string | null;
}

/**
 * The app's keyboard shortcuts that work on every page: `/` search, `N` new
 * note, `U` upload, `g` then a letter to go to a view, `?` for the list of
 * shortcuts, and ⌘K (Ctrl+K) for the command palette. Card shortcuts belong
 * to the grid.
 */
export function LibraryShortcuts({
  onGoToView,
  onNavigate,
  onSignOut,
  pathname,
}: LibraryShortcutsProps) {
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
  const closeDialogThen = useCallback(
    (action: () => void) => () => {
      if (isDialogOpenRef.current) {
        afterCloseRef.current = action;
        setDialogOpen(false);
        return;
      }
      action();
    },
    [setDialogOpen]
  );

  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const isPaletteOpenRef = useRef(false);
  const setPaletteOpen = useCallback((open: boolean) => {
    isPaletteOpenRef.current = open;
    setIsPaletteOpen(open);
  }, []);
  // A chosen row runs once the palette has closed and released focus, so
  // the composer, a card or the shortcuts list can take it.
  const afterPaletteCloseRef = useRef<(() => void) | null>(null);
  // Radix gives focus back to a dialog's trigger, and the palette has none:
  // remember what had focus so Esc returns there (the search box, a card).
  const paletteReturnFocusRef = useRef<HTMLElement | null>(null);
  const { resolvedTheme, setTheme } = useTheme();

  const newNote = useCallback(() => {
    if (!focusNewNoteComposer()) {
      // Only Everything has the composer: open it, then focus it.
      requestNewNoteComposerFocus();
      onGoToView("all");
    }
  }, [onGoToView]);

  // Its own listener: shortcuts ignore keys held with Cmd or Ctrl. It
  // listens in the bubble phase so a text editor's Cmd+K (edit a link)
  // runs first and prevents it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isPaletteOpenRef.current) {
        if (isCommandPaletteKey(event)) {
          event.preventDefault();
          setPaletteOpen(false);
        }
        return;
      }
      if (!shouldOpenPalette(event)) {
        return;
      }
      event.preventDefault();
      closeDialogThen(() => {
        const focused = document.activeElement;
        paletteReturnFocusRef.current =
          focused instanceof HTMLElement && focused !== document.body
            ? focused
            : null;
        setPaletteOpen(true);
      })();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDialogThen, setPaletteOpen]);

  const runCommand = useCallback(
    (command: CommandPaletteCommand) => {
      switch (command.kind) {
        case "navigate":
          onNavigate(command.href);
          return;
        case "card":
          onNavigate(
            paletteCardHref(
              command.cardId,
              window.location.pathname,
              window.location.search
            )
          );
          return;
        case "search":
          onNavigate(
            paletteSearchAllHref(command.query, window.location.pathname)
          );
          return;
        default:
          break;
      }
      switch (command.id) {
        case "new-note":
          newNote();
          return;
        case "upload":
          pressUploadFiles();
          return;
        case "import":
        case "export":
          onNavigate(settingsDialogHref(command.id));
          return;
        case "toggle-theme":
          setTheme(resolvedTheme === "dark" ? "light" : "dark");
          return;
        case "shuffle":
          onNavigate(
            paletteShuffleHref(window.location.pathname, window.location.search)
          );
          return;
        case "shortcuts":
          setDialogOpen(true);
          return;
        case "sign-out":
          onSignOut();
          return;
        default:
          return;
      }
    },
    [newNote, onNavigate, onSignOut, resolvedTheme, setDialogOpen, setTheme]
  );

  const handlePaletteSelect = useCallback(
    (command: CommandPaletteCommand) => {
      // A second Enter while it closes runs nothing more.
      if (!isPaletteOpenRef.current) {
        return;
      }
      afterPaletteCloseRef.current = () => runCommand(command);
      setPaletteOpen(false);
    },
    [runCommand, setPaletteOpen]
  );

  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      {
        keys: "/",
        run: closeDialogThen(() => {
          focusLibrarySearch();
        }),
      },
      {
        keys: "n",
        run: closeDialogThen(newNote),
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
    ],
    [closeDialogThen, newNote, onGoToView, setDialogOpen]
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <>
      <CommandPalette
        onCloseAutoFocus={(event) => {
          const action = afterPaletteCloseRef.current;
          const returnFocus = paletteReturnFocusRef.current;
          afterPaletteCloseRef.current = null;
          paletteReturnFocusRef.current = null;
          if (action) {
            // The command decides where focus goes, not the palette.
            event.preventDefault();
            action();
            return;
          }
          if (returnFocus?.isConnected) {
            event.preventDefault();
            returnFocus.focus({ preventScroll: true });
          }
        }}
        onOpenChange={setPaletteOpen}
        onSelect={handlePaletteSelect}
        open={isPaletteOpen}
        pathname={pathname}
      />
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
    </>
  );
}
