import { describe, expect, mock, test } from "bun:test";
import { triggerCustomerPortal } from "../CustomerPortalButton";

describe("triggerCustomerPortal", () => {
  test("calls the callback exactly once", async () => {
    const onCreatePortal = mock(async () => {});

    await triggerCustomerPortal(onCreatePortal);

    expect(onCreatePortal).toHaveBeenCalledTimes(1);
  });

  test("does not require a URL return value", async () => {
    const onCreatePortal = mock(async () => {});

    const result = await triggerCustomerPortal(onCreatePortal);

    expect(result).toBeUndefined();
  });

  test("propagates callback failures", async () => {
    const onCreatePortal = mock(async () => {
      throw new Error("portal failed");
    });

    await expect(triggerCustomerPortal(onCreatePortal)).rejects.toThrow(
      "portal failed"
    );
  });
});
