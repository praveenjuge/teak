"use client";

import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type KeyboardShortcut,
  useKeyboardShortcuts,
} from "../../hooks/useKeyboardShortcuts";
import { useReturnFocus } from "../../hooks/useReturnFocus";
import { useRunAfterClose } from "../../hooks/useRunAfterClose";
import {
  type AppActionId,
  appActionKey,
  GO_TO,
  GO_TO_TARGETS,
  type GoToTarget,
  goToSequence,
  isLibraryViewTarget,
} from "../../lib/appCommands";
import {
  isCommandPaletteKey,
  paletteCardHref,
  paletteSearchAllHref,
  paletteShuffleHref,
  settingsDataHref,
  shouldOpenPalette,
} from "../../lib/commandPalette";
import {
  CARD_DIALOG_ATTRIBUTE,
  focusLibrarySearch,
  startNewNote,
} from "../../lib/keyboardShortcuts";
import { onDemand, whenIdle } from "../../lib/lazyWithPreload";
import type { GoToViewOptions, LibraryView } from "../../lib/libraryViews";
import type { CommandPaletteCommand } from "../command-palette/CommandPalette";
import {
  useLibraryCommand,
  useRunLibraryCommand,
} from "../providers/LibraryCommandsProvider";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";

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

/** The actions a single key runs; the palette's key and `?` work apart. */
const KEY_ACTIONS = [
  "search",
  "newNote",
  "uploadFiles",
  "recordAudio",
] as const satisfies readonly AppActionId[];

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
  const returnShortcutsFocus = useReturnFocus(isDialogOpen);
  const shortcutsDialog = useRunAfterClose(returnShortcutsFocus);
  // A shortcut pressed in the list closes it first and runs once it has
  // closed (see useRunAfterClose).
  const { runAfterClose: runAfterDialogCloses } = shortcutsDialog;
  const closeDialogThen = useCallback(
    (action: () => void) => () => {
      if (isDialogOpenRef.current) {
        runAfterDialogCloses(action);
        setDialogOpen(false);
        return;
      }
      action();
    },
    [runAfterDialogCloses, setDialogOpen]
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
  const returnPaletteFocus = useReturnFocus(isPaletteOpen);
  const palette = useRunAfterClose(returnPaletteFocus);
  const { resolvedTheme, setTheme, systemTheme } = useTheme();
  const runLibraryCommand = useRunLibraryCommand();

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

  const goTo = useCallback(
    (target: GoToTarget) => {
      if (isLibraryViewTarget(target)) {
        onGoToView(target);
      } else {
        onNavigate(GO_TO[target].href);
      }
    },
    [onGoToView, onNavigate]
  );

  // What each app action does, whether a key or the palette ran it.
  const runAction = useCallback(
    (id: AppActionId) => {
      switch (id) {
        case "search":
          focusLibrarySearch();
          return;
        case "newNote":
          startNewNote(onGoToView);
          return;
        case "uploadFiles":
        case "recordAudio":
        case "emptyTrash":
          runLibraryCommand(id);
          return;
        case "import":
        case "export":
          onNavigate(settingsDataHref(id));
          return;
        case "toggleTheme":
          setTheme(toggledTheme(resolvedTheme, systemTheme));
          return;
        case "shuffle":
          onNavigate(
            paletteShuffleHref(window.location.pathname, window.location.search)
          );
          return;
        case "keyboardShortcuts":
          setDialogOpen(true);
          return;
        case "signOut":
          onSignOut();
          return;
        case "commandPalette":
          setPaletteOpen(true);
          return;
        default:
          return;
      }
    },
    [
      onGoToView,
      onNavigate,
      onSignOut,
      resolvedTheme,
      runLibraryCommand,
      setDialogOpen,
      setPaletteOpen,
      setTheme,
      systemTheme,
    ]
  );

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
        case "action":
          runAction(command.id);
          return;
        default:
          return;
      }
    },
    [onNavigate, runAction]
  );

  const { runAfterClose: runAfterPaletteCloses } = palette;
  const handlePaletteSelect = useCallback(
    (command: CommandPaletteCommand) => {
      if (!isPaletteOpenRef.current) {
        return;
      }
      runAfterPaletteCloses(() => runCommand(command));
      setPaletteOpen(false);
    },
    [runAfterPaletteCloses, runCommand, setPaletteOpen]
  );

  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      ...KEY_ACTIONS.map((id) => ({
        keys: appActionKey(id),
        run: closeDialogThen(() => runAction(id)),
      })),
      {
        alsoOver: CARD_DIALOG_ATTRIBUTE,
        keys: appActionKey("keyboardShortcuts"),
        run: () => setDialogOpen(!isDialogOpenRef.current),
      },
      ...GO_TO_TARGETS.map((target) => ({
        keys: goToSequence(target),
        run: closeDialogThen(() => goTo(target)),
      })),
    ],
    [closeDialogThen, goTo, runAction, setDialogOpen]
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
        onCloseAutoFocus={palette.onCloseAutoFocus}
        onOpenChange={setPaletteOpen}
        onSelect={handlePaletteSelect}
        open={isPaletteOpen}
        pathname={pathname}
      />
      <KeyboardShortcutsDialog
        onCloseAutoFocus={shortcutsDialog.onCloseAutoFocus}
        onOpenChange={setDialogOpen}
        open={isDialogOpen}
      />
    </>
  );
}
