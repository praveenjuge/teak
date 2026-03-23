import { describe, expect, test } from "bun:test";
import {
  buildPublicAppUrl,
  resolvePublicAppOrigin,
} from "@/lib/public-app-url";

describe("public app URL resolution", () => {
  test("pins local requests to the public dev app origin", () => {
    const requestUrl = new URL("http://localhost:4015/login?next=%2Fsettings");

    expect(resolvePublicAppOrigin(requestUrl)).toBe(
      "http://app.teak.localhost:1355"
    );
    expect(buildPublicAppUrl("/login", requestUrl).toString()).toBe(
      "http://app.teak.localhost:1355/login"
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
