import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(
  new URL("../Shared (App)/Resources/Script.js", import.meta.url),
  "utf8"
);

const setup = () => {
  const classes = new Set<string>();
  const status = { innerText: "" };
  const context = createContext({
    document: {
      body: {
        classList: {
          contains: (name: string) => classes.has(name),
          toggle: (name: string, enabled: boolean) =>
            enabled ? classes.add(name) : classes.delete(name),
        },
      },
      getElementById: (id: string) =>
        id === "account-status" ? status : { addEventListener() {} },
    },
    webkit: { messageHandlers: { controller: { postMessage() {} } } },
  });
  runInContext(source, context);
  return { context, classes, status };
};

describe("Safari companion account feedback", () => {
  test("failed sign-out keeps the sign-out action available and explains the failure", () => {
    const { context, classes, status } = setup();
    runInContext("renderAccountState({authenticated: true})", context);
    expect(classes.has("signed-in")).toBe(true);
    runInContext(
      'renderAccountState({status: "error", authenticated: true, message: "Could not disconnect. Please try again."})',
      context
    );
    expect(classes.has("signed-in")).toBe(true);
    expect(status.innerText).toBe("Could not disconnect. Please try again.");
    runInContext(
      'renderAccountState({status: "signed-out", authenticated: false})',
      context
    );
    expect(classes.has("signed-in")).toBe(false);
  });

  test("a message alone does not discard the current authenticated presentation", () => {
    const { context, classes, status } = setup();
    runInContext("renderAccountState({authenticated: true})", context);
    runInContext('renderAccountState({message: "Please try again."})', context);
    expect(classes.has("signed-in")).toBe(true);
    expect(status.innerText).toBe("Please try again.");
  });
});
