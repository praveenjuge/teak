import { describe, expect, test } from "bun:test";
import { workosEntryRedirect } from "@/lib/auth-entry";

const target = (path: string, signedIn = false) =>
  workosEntryRedirect(
    new URL(path, "http://localhost:3142"),
    signedIn
  )?.toString() ?? null;

describe("WorkOS entry redirect", () => {
  test("returns signed-in visitors to their destination", () => {
    expect(target("/login?next=%2Fsettings", true)).toBe(
      "http://localhost:3142/settings"
    );
    expect(target("/register", true)).toBe("http://localhost:3142/");
  });
  test("drops off-site and auth-page destinations", () => {
    expect(target("/login?next=%2F%2Fevil.example", true)).toBe(
      "http://localhost:3142/"
    );
    expect(target("/sign-in?next=%2F.%2F%2Fevil.example", true)).toBe(
      "http://localhost:3142/"
    );
    expect(target("/register?next=%2Flogin")).toBe(
      "http://localhost:3142/sign-up"
    );
  });
  test("leaves other pages alone", () => {
    expect(target("/settings")).toBeNull();
    expect(target("/settings", true)).toBeNull();
    expect(target("/sign-in")).toBeNull();
    expect(target("/sign-up?next=%2Fsettings")).toBeNull();
    expect(target("/login/extra")).toBeNull();
    expect(target("/forgot-password")).toBeNull();
    expect(target("/reset-password")).toBeNull();
  });
  test.each([
    [
      "/sign-in?next=%2Fsettings%3Ftab%3Dapi",
      "http://localhost:3142/settings?tab=api",
    ],
    ["/sign-up", "http://localhost:3142/"],
    ["/sign-in?next=https%3A%2F%2Fevil.example", "http://localhost:3142/"],
  ])("skips AuthKit for a signed-in visit to %s", (path, destination) => {
    expect(target(path, true)).toBe(destination);
  });
  test.each([
    ["after a failed callback", "/sign-in?reauth=1"],
    [
      "to renew a session the app rejected",
      "/sign-in?renew=1&next=%2Fsettings",
    ],
  ])("sends a signed-in visitor to AuthKit %s", (_reason, path) => {
    expect(target(path, true)).toBeNull();
  });
});
