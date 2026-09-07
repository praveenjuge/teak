import { describe, expect, test } from "bun:test";
import {
  buildPublicAppUrl,
  resolvePublicAppOrigin,
} from "@/lib/public-app-url";

describe("public app URL resolution", () => {
  test("pins local requests to the local dev app origin", () => {
    const requestUrl = new URL("http://localhost:4015/login?next=%2Fsettings");

    expect(resolvePublicAppOrigin(requestUrl)).toBe("http://localhost:3000");
    expect(buildPublicAppUrl("/login", requestUrl).toString()).toBe(
      "http://localhost:3000/login"
    );
  });

  test("preserves the request protocol for local origins", () => {
    const requestUrl = new URL("https://localhost:3000/settings");

    expect(resolvePublicAppOrigin(requestUrl)).toBe("https://localhost:3000");
    expect(buildPublicAppUrl("/login", requestUrl).toString()).toBe(
      "https://localhost:3000/login"
    );
  });

  test("preserves non-local origins", () => {
    const requestUrl = new URL("https://preview.teakvault.com/login");

    expect(resolvePublicAppOrigin(requestUrl)).toBe(
      "https://preview.teakvault.com"
    );
    expect(buildPublicAppUrl("/", requestUrl).toString()).toBe(
      "https://preview.teakvault.com/"
    );
  });
});
