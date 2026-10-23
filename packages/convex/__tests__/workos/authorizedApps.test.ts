import { afterEach, expect, test } from "bun:test";
import {
  deleteAuthorizedApp,
  listAuthorizedAppsPage,
} from "../../workos/authorizedApps";
import { asFetch } from "../helpers/convex.test-utils";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const stubProvider = (respond: () => Response) => {
  const requests: { method: string; url: URL }[] = [];
  globalThis.fetch = asFetch((input, init) => {
    requests.push({
      method: init?.method ?? "GET",
      url: new URL(input instanceof Request ? input.url : String(input)),
    });
    return Promise.resolve(respond());
  });
  return requests;
};
const page = { limit: 10, timeoutMs: 1000 };

test("a page longer than the requested limit is rejected", async () => {
  const requests = stubProvider(() =>
    Response.json({
      data: Array.from({ length: 11 }, (_, index) => ({
        application: { id: `conn_app_TEST${index}` },
      })),
    })
  );
  await expect(
    listAuthorizedAppsPage("user_TEST", "test-key", page)
  ).rejects.toThrow("workos_authorized_apps_invalid");
  expect(requests.map(({ url }) => url.searchParams.get("limit"))).toEqual([
    "10",
  ]);
});

test.each(["conn_app_TEST", "connect_app_01M40P8YVQV6ED9DCMYM0BYZG0"])(
  "deletes the exact supported app ID %s",
  async (appId) => {
    const requests = stubProvider(() => new Response(null, { status: 204 }));
    await deleteAuthorizedApp("user_TEST", appId, "test-key", 1000);
    expect(
      requests.map(({ method, url }) => `${method} ${url.pathname}`)
    ).toEqual([
      `DELETE /user_management/users/user_TEST/authorized_applications/${appId}`,
    ]);
  }
);

test.each([
  "connect_app_",
  "connect_app_TEST/OTHER",
  "connect_app_TEST%2fOTHER",
  "authorized_connect_app_TEST",
  "client_TEST",
])("rejects the malformed or wrong-kind app ID %s", async (appId) => {
  const requests = stubProvider(() =>
    Response.json({ data: [{ application: { id: appId } }] })
  );
  await expect(
    listAuthorizedAppsPage("user_TEST", "test-key", page)
  ).rejects.toThrow("workos_authorized_apps_invalid");
  await expect(
    deleteAuthorizedApp("user_TEST", appId, "test-key", 1000)
  ).rejects.toThrow("workos_authorized_apps_invalid");
  expect(requests.map(({ method }) => method)).toEqual(["GET"]);
});
