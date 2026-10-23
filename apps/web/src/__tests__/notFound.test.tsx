import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import NotFound from "../app/not-found";

test("an unknown route shows Teak's not-found page with a way home", () => {
  const markup = renderToStaticMarkup(<NotFound />);

  expect(markup).toContain("<h1");
  expect(markup).toContain("Page not found");
  expect(markup).toMatch(/<a[^>]*href="\/"[^>]*>Go to your cards<\/a>/);
});
