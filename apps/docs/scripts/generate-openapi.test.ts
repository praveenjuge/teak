import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSpecJson, writeIfChanged } from "./generate-openapi.ts";

describe("buildSpecJson", () => {
  test("serializes with a trailing newline", () => {
    expect(buildSpecJson({ openapi: "3.1.0" })).toBe(
      '{\n  "openapi": "3.1.0"\n}\n'
    );
  });
});

describe("writeIfChanged", () => {
  test("writes once, then reports unchanged", () => {
    const path = join(
      mkdtempSync(join(tmpdir(), "teak-openapi-")),
      "openapi.json"
    );
    expect(writeIfChanged(path, '{"a":1}\n')).toBe("wrote");
    expect(writeIfChanged(path, '{"a":1}\n')).toBe("unchanged");
    expect(writeIfChanged(path, '{"a":2}\n')).toBe("wrote");
    expect(readFileSync(path, "utf-8")).toBe('{"a":2}\n');
  });
});
