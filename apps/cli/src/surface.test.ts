import { expect, test } from "bun:test";
import type { CommandDescription } from "./help";
import { describeCli } from "./help";
import { program, SHORTCUTS } from "./index";

/**
 * The CLI's public surface: every visible command, its aliases, arguments
 * and options. Scripts depend on these names, so a change here is a contract
 * change that needs an intended reason, a deprecation path for anything
 * removed or renamed, and an update with `bun test -u`.
 */
const surface = (command: CommandDescription): unknown => ({
  command: command.command,
  ...(command.aliases.length ? { aliases: command.aliases } : {}),
  arguments: command.arguments.map(
    ({ name, required, variadic }) =>
      `${required ? "<" : "["}${name}${variadic ? "..." : ""}${required ? ">" : "]"}`
  ),
  options: command.options.map((option) => option.flags),
  ...(command.commands.length
    ? { commands: command.commands.map(surface) }
    : {}),
});

test("the command surface stays as published", () => {
  expect(surface(describeCli(program, SHORTCUTS))).toMatchSnapshot();
});
