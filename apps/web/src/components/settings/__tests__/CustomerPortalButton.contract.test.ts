import { describe, expect, mock, test } from "bun:test";
import { triggerCustomerPortal } from "../../../lib/customerPortal";

describe("triggerCustomerPortal", () => {
  test("calls the callback exactly once", async () => {
    const onCreatePortal = mock(() => Promise.resolve());

    await triggerCustomerPortal(onCreatePortal);

    expect(onCreatePortal).toHaveBeenCalledTimes(1);
  });

  test("does not require a URL return value", async () => {
    const onCreatePortal = mock(() => Promise.resolve());

    const result = await triggerCustomerPortal(onCreatePortal);

    expect(result).toBeUndefined();
  });

  test("propagates callback failures", async () => {
    const onCreatePortal = mock(() =>
      Promise.reject(new Error("portal failed"))
    );

    await expect(triggerCustomerPortal(onCreatePortal)).rejects.toThrow(
      "portal failed"
    );
  });
});
