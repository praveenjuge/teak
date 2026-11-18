import { describe, expect, mock, test } from "bun:test";
import { triggerCustomerPortal } from "../../../lib/customerPortal";

describe("triggerCustomerPortal", () => {
  test("calls the callback exactly once", async () => {
    const onCreatePortal = mock(() => Promise.resolve());

    await triggerCustomerPortal(onCreatePortal);

    expect(onCreatePortal).toHaveBeenCalledTimes(1);
  });
});
