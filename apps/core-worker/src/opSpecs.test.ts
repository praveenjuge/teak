import { expect, test } from "bun:test";
import { FILES_NETWORK_OPS } from "@teak/files-protocol";
import { isFilesOp, WORKER_OPS } from "./opSpecs";

test("the Worker's own ops never shadow an op Convex may send", () => {
  const network = new Set<string>(FILES_NETWORK_OPS);
  expect(WORKER_OPS.filter((op) => network.has(op))).toEqual([]);
});

test.each([
  ["a network op", "store-linked-pdf", true],
  ["a Worker op", "analyze-image", true],
  ["an unknown op", "process_image", false],
  ["an inherited property", "toString", false],
])("knows %s", (_name, op, known) => {
  expect(isFilesOp(op)).toBe(known);
});
