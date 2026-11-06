"use client";

import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type KeyboardShortcut,
  useKeyboardShortcuts,
} from "../../hooks/useKeyboardShortcuts";
import { useReturnFocus } from "../../hooks/useReturnFocus";
import {
  isCommandPaletteKey,
  paletteCardHref,
  paletteSearchAllHref,
  paletteShuffleHref,
  settingsDataHref,
  shouldOpenPalette,
} from "../../lib/commandPalette";
import {
  APP_KEYS,
  CARD_DIALOG_ATTRIBUTE,
  focusLibrarySearch,
  focusNewNoteComposer,
  GO_TO_SETTINGS_KEY,
  GO_TO_TAGS_KEY,
  GO_TO_VIEW_KEYS,
} from "../../lib/keyboardShortcuts";
import { onDemand, whenIdle } from "../../lib/lazyWithPreload";
import {
  type GoToViewOptions,
  LIBRARY_VIEWS,
  type LibraryView,
} from "../../lib/libraryViews";
import type { CommandPaletteCommand } from "../command-palette/CommandPalette";
import { KeyboardShortcutsDialog } from "../modals/KeyboardShortcutsDialog";
import {
  useLibraryCommand,
  useRunLibraryCommand,
} from "../providers/LibraryCommandsProvider";

const CommandPalette = onDemand(() =>
  import("../command-palette/CommandPalette").then(
    (module) => module.CommandPalette
  )
);

interface LibraryShortcutsProps {
  onGoToView: (view: LibraryView, options?: GoToViewOptions) => void;
  onNavigate: (href: string) => void;
  onSignOut: () => void;
  pathname: string | null;
}

/**
 * Flips light and dark. Flipping back to what the system uses goes back to
 * following the system, so one toggle never turns "System" off for good.
 */
export function toggledTheme(
  resolved: string | undefined,
  system: string | undefined
): "dark" | "light" | "system" {
  const next = resolved === "dark" ? "light" : "dark";
  return next === system ? "system" : next;
}

export function LibraryShortcuts({
  onGoToView,
  onNavigate,
  onSignOut,
  pathname,
}: LibraryShortcutsProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const isDialogOpenRef = useRef<boolean>(false);
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

  useEffect(
    () =>
      whenIdle(() => {
        CommandPalette.preload().catch(() => undefined);
      }),
    []
  );

  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const isPaletteOpenRef = useRef<boolean>(false);
  const setPaletteOpen = useCallback((open: boolean) => {
    isPaletteOpenRef.current = open;
    setIsPaletteOpen(open);
  }, []);
  const afterPaletteCloseRef = useRef<(() => void) | null>(null);
  const returnPaletteFocus = useReturnFocus(isPaletteOpen);
  const returnShortcutsFocus = useReturnFocus(isDialogOpen);
  const { resolvedTheme, setTheme, systemTheme } = useTheme();
  const runLibraryCommand = useRunLibraryCommand();

  const newNote = useCallback(() => {
    if (!focusNewNoteComposer()) {
      onGoToView("all", { focusComposer: true });
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
      closeDialogThen(() => setPaletteOpen(true))();
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
          runLibraryCommand("uploadFiles");
          return;
        case "import":
        case "export":
          onNavigate(settingsDataHref(command.id));
          return;
        case "toggle-theme":
          setTheme(toggledTheme(resolvedTheme, systemTheme));
          return;
        case "shuffle":
          onNavigate(
            paletteShuffleHref(window.location.pathname, window.location.search)
          );
          return;
        case "shortcuts":
          setDialogOpen(true);
          return;
        case "empty-trash":
          runLibraryCommand("emptyTrash");
          return;
        case "sign-out":
          onSignOut();
          return;
        default:
          return;
      }
    },
    [
      newNote,
      onNavigate,
      onSignOut,
      resolvedTheme,
      runLibraryCommand,
      setDialogOpen,
      setTheme,
      systemTheme,
    ]
  );

  const handlePaletteSelect = useCallback(
    (command: CommandPaletteCommand) => {
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
        keys: APP_KEYS.search,
        run: closeDialogThen(() => {
          focusLibrarySearch();
        }),
      },
      {
        keys: APP_KEYS.newNote,
        run: closeDialogThen(newNote),
      },
      {
        keys: APP_KEYS.uploadFiles,
        run: closeDialogThen(() => {
          runLibraryCommand("uploadFiles");
        }),
      },
      {
        keys: APP_KEYS.recordAudio,
        run: closeDialogThen(() => {
          runLibraryCommand("recordAudio");
        }),
      },
      {
        alsoOver: CARD_DIALOG_ATTRIBUTE,
        keys: APP_KEYS.keyboardShortcuts,
        run: () => setDialogOpen(!isDialogOpenRef.current),
      },
      ...LIBRARY_VIEWS.map((view) => ({
        keys: `g ${GO_TO_VIEW_KEYS[view]}`,
        run: closeDialogThen(() => {
          onGoToView(view);
        }),
      })),
      {
        keys: `g ${GO_TO_TAGS_KEY}`,
        run: closeDialogThen(() => {
          onNavigate("/tags");
        }),
      },
      {
        keys: `g ${GO_TO_SETTINGS_KEY}`,
        run: closeDialogThen(() => {
          onNavigate("/settings");
        }),
      },
    ],
    [
      closeDialogThen,
      newNote,
      onGoToView,
      onNavigate,
      runLibraryCommand,
      setDialogOpen,
    ]
  );

  // The open palette's dialog holds the keys back, but on a first open its
  // code may still be loading, with no dialog in the page yet.
  useKeyboardShortcuts(shortcuts, { enabled: !isPaletteOpen });

  useLibraryCommand("openShortcuts", () => {
    setDialogOpen(true);
    return true;
  });

  return (
    <>
      <CommandPalette
        onCloseAutoFocus={(event) => {
          const action = afterPaletteCloseRef.current;
          afterPaletteCloseRef.current = null;
          if (action) {
            event.preventDefault();
            action();
            return;
          }
          returnPaletteFocus(event);
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
            event.preventDefault();
            action();
            return;
          }
          returnShortcutsFocus(event);
        }}
        onOpenChange={setDialogOpen}
        open={isDialogOpen}
      />
    </>
  );
}
