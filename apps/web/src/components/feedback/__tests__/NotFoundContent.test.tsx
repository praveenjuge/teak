import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TestRouter, testRouter } from "@/__tests__/helpers/router";
import { NotFoundContent } from "../NotFoundContent";

test("an unknown route shows Teak's not-found page with a way home", () => {
  const markup = renderToStaticMarkup(
    <TestRouter router={testRouter("/no/such/page")}>
      <NotFoundContent />
    </TestRouter>
  );

  expect(markup).toContain("<h1");
  expect(markup).toContain("Page not found");
  expect(markup).toMatch(/<a[^>]*href="\/"[^>]*>Go to your cards<\/a>/);
});
