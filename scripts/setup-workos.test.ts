import { describe, expect, test } from "bun:test";
import { planWorkosApiBase, planWorkosCredential } from "./setup-workos.ts";

describe("planWorkosApiBase", () => {
  test("defaults a fresh deployment to production WorkOS", () => {
    expect(planWorkosApiBase({})).toEqual({
      value: "https://api.workos.com",
      setDeployment: true,
    });
  });

  test("uses an exported emulator origin for a fresh deployment", () => {
    expect(planWorkosApiBase({ explicit: "http://localhost:4100" })).toEqual({
      value: "http://localhost:4100",
      setDeployment: true,
    });
  });

  test("never overwrites a deployment value", () => {
    expect(
      planWorkosApiBase({
        deployment: "http://localhost:4100",
        explicit: "https://api.workos.com",
      })
    ).toEqual({ value: "http://localhost:4100", setDeployment: false });
  });
});

describe("planWorkosCredential", () => {
  test("reports a credential missing from every source", () => {
    expect(planWorkosCredential("WORKOS_CLIENT_ID", { explicit: " " })).toEqual(
      { name: "WORKOS_CLIENT_ID", status: "missing" }
    );
  });

  test("sets the deployment from an explicit export", () => {
    expect(
      planWorkosCredential("WORKOS_API_KEY", { explicit: "sk_test_a" })
    ).toEqual({
      name: "WORKOS_API_KEY",
      status: "ready",
      value: "sk_test_a",
      setDeployment: true,
    });
  });

  test("syncs a deployment value to the web without setting it again", () => {
    expect(
      planWorkosCredential("WORKOS_CLIENT_ID", { deployment: "client_a" })
    ).toEqual({
      name: "WORKOS_CLIENT_ID",
      status: "ready",
      value: "client_a",
      setDeployment: false,
    });
  });

  test("seeds a fresh deployment from the web dotenv file", () => {
    expect(
      planWorkosCredential("WORKOS_CLIENT_ID", { web: "client_a" })
    ).toMatchObject({
      status: "ready",
      value: "client_a",
      setDeployment: true,
    });
  });

  test.each([
    [{ explicit: "client_b", deployment: "client_a" }, "the shell export"],
    [{ deployment: "client_a", web: "client_b" }, "apps/web/.env.local"],
  ])(
    "refuses sources that disagree instead of overwriting (%#)",
    (sources, label) => {
      const plan = planWorkosCredential("WORKOS_CLIENT_ID", sources);
      expect(plan.status).toBe("conflict");
      expect(JSON.stringify(plan)).toContain(label);
      expect(JSON.stringify(plan)).not.toContain("client_a");
      expect(JSON.stringify(plan)).not.toContain("client_b");
    }
  );
});
