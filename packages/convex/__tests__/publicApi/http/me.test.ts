import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { mockActionCtx } from "../../helpers/convex.test-utils";
import {
  buildAuthorizedMutationMock,
  callPublicApi,
} from "../../helpers/publicApiHttp.test-utils";
import { withMappedOwner } from "../../helpers/session.test-utils";

const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);

afterEach(() => {
  errorSpy.mockClear();
});

test("GET /v1/me logs why the profile failed before answering 500", async () => {
  const response = await callPublicApi(
    mockActionCtx(
      withMappedOwner({
        runMutation: buildAuthorizedMutationMock(),
        runQuery: mock().mockRejectedValue(new Error("profile read failed")),
      })
    ),
    {
      method: "GET",
      path: "/v1/me",
      headers: {
        Authorization: `Bearer teakapi_secret_live_a1b2c3d4_${"f".repeat(64)}`,
      },
    }
  );

  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ code: "INTERNAL_ERROR" });
  expect(errorSpy).toHaveBeenCalledWith(
    "[publicApi] user profile unavailable",
    { error: "profile read failed" }
  );
});
