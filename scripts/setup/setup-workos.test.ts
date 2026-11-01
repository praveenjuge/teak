import { describe, expect, test } from "bun:test";
import { planWorkosCredential } from "./setup-workos.ts";

describe("planWorkosCredential", () => {
  test("uses the dev deployment's value", () => {
    expect(
      planWorkosCredential("WORKOS_CLIENT_ID", { deployment: "client_a" })
    ).toEqual({ name: "WORKOS_CLIENT_ID", status: "ready", value: "client_a" });
  });

  test("a matching export is fine", () => {
    expect(
      planWorkosCredential("WORKOS_API_KEY", {
        deployment: "sk_test_a",
        explicit: "sk_test_a",
      })
    ).toMatchObject({ status: "ready", value: "sk_test_a" });
  });

  test("reports a credential the deployment lacks", () => {
    expect(
      planWorkosCredential("WORKOS_CLIENT_ID", { explicit: "client_a" })
    ).toMatchObject({ status: "invalid" });
  });

  test("refuses a production API key on the dev deployment", () => {
    const plan = planWorkosCredential("WORKOS_API_KEY", {
      deployment: "sk_live_a",
    });
    expect(plan.status).toBe("invalid");
    expect(JSON.stringify(plan)).toContain("production key");
    expect(JSON.stringify(plan)).not.toContain("sk_live_a");
  });

  test("refuses an export that disagrees instead of using it", () => {
    const plan = planWorkosCredential("WORKOS_CLIENT_ID", {
      deployment: "client_a",
      explicit: "client_b",
    });
    expect(plan.status).toBe("invalid");
    expect(JSON.stringify(plan)).toContain("exported");
    expect(JSON.stringify(plan)).not.toContain("client_a");
    expect(JSON.stringify(plan)).not.toContain("client_b");
  });
});
