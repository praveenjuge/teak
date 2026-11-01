import { expect, test } from "bun:test";
import { isDocumentRequest } from "../documentRequest";

test("a browser page load is a document request", () => {
  expect(
    isDocumentRequest(
      new Headers({
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      })
    )
  ).toBe(true);
});

test("a router fetch for server components is not", () => {
  expect(isDocumentRequest(new Headers({ accept: "*/*", rsc: "1" }))).toBe(
    false
  );
  expect(isDocumentRequest(new Headers())).toBe(false);
});
