import { expect, mock, test } from "bun:test";
import { isRedirect } from "@tanstack/react-router";

// Start's compiler turns a server function into an RPC; here its handler
// runs directly, signed out.
const sdk = await import("@workos/authkit-tanstack-react-start");
const start = await import("@tanstack/react-start");
mock.module("@tanstack/react-start", () => ({
  ...start,
  createServerFn: () => ({
    validator: () => ({ handler: (handler: unknown) => handler }),
  }),
}));
mock.module("@workos/authkit-tanstack-react-start", () => ({
  ...sdk,
  getAuth: async () => ({ user: null }),
}));

const { loadAppSession } = await import("../lib/appSession");
const handler = loadAppSession as unknown as (input: {
  data: { pageLoad: boolean; path: string; seeds: boolean };
}) => Promise<unknown>;

test("a signed-out navigation in the app loads /sign-in as a page", async () => {
  const thrown = await handler({
    data: { pageLoad: false, path: "/?card=abc", seeds: false },
  }).catch((error: unknown) => error);

  // /sign-in has only a server handler, so the router can't render it in
  // the page: without a page load the person sees "Page not found".
  expect(isRedirect(thrown)).toBe(true);
  expect((thrown as Response & { options: object }).options).toMatchObject({
    href: "/sign-in?next=%2F%3Fcard%3Dabc",
    reloadDocument: true,
  });
});
