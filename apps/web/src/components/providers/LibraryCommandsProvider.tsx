"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * What a shortcut or the command palette can ask of a part of the page that
 * isn't its child: the composer uploads or records, Trash empties, the shell
 * opens the shortcuts list. Whatever offers the command registers a handler;
 * the latest one mounted answers.
 */
export type LibraryCommand =
  | "emptyTrash"
  | "openShortcuts"
  | "recordAudio"
  | "uploadFiles";

/** Returns false when it can't run now (an upload already running, say). */
type CommandHandler = () => boolean | undefined;

interface LibraryCommands {
  register: (command: LibraryCommand, handler: CommandHandler) => () => void;
  run: (command: LibraryCommand) => boolean;
}

const LibraryCommandsContext = createContext<LibraryCommands | null>(null);

export function LibraryCommandsProvider({ children }: { children: ReactNode }) {
  const [commands] = useState<LibraryCommands>(() => {
    const handlers = new Map<LibraryCommand, CommandHandler[]>();
    return {
      register: (command, handler) => {
        handlers.set(command, [...(handlers.get(command) ?? []), handler]);
        return () => {
          handlers.set(
            command,
            (handlers.get(command) ?? []).filter((item) => item !== handler)
          );
        };
      },
      run: (command) => {
        const handler = handlers.get(command)?.at(-1);
        return handler ? handler() !== false : false;
      },
    };
  });
  return (
    <LibraryCommandsContext.Provider value={commands}>
      {children}
    </LibraryCommandsContext.Provider>
  );
}

/** Answers `command` while this component is mounted. */
export function useLibraryCommand(
  command: LibraryCommand,
  handler: CommandHandler
) {
  const commands = useContext(LibraryCommandsContext);
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(
    () => commands?.register(command, () => handlerRef.current()),
    [command, commands]
  );
}

/** Runs a command; false when nothing on the page answers it now. */
export function useRunLibraryCommand(): (command: LibraryCommand) => boolean {
  const commands = useContext(LibraryCommandsContext);
  return useCallback(
    (command: LibraryCommand) => commands?.run(command) ?? false,
    [commands]
  );
}
