import { describe, expect, test } from "bun:test";
import { workosEntryRedirect } from "@/lib/auth-entry";

const target = (path: string, signedIn = false) =>
  workosEntryRedirect(
    new URL(path, "http://localhost:3142"),
    signedIn
  )?.toString() ?? null;

// Failure modes: a signed-in visitor bounced through hosted sign-in, an open
// redirect through `next`, and redirecting pages that are not entry pages.
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
    expect(target("/register?next=%2Flogin")).toBe(
      "http://localhost:3142/sign-up"
    );
  });
  test("leaves other pages alone", () => {
    expect(target("/settings")).toBeNull();
    expect(target("/sign-in")).toBeNull();
    expect(target("/login/extra")).toBeNull();
  });
});
