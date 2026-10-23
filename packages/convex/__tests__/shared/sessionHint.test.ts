import { describe, expect, test } from "bun:test";
import { sessionHintDomain } from "../../shared/sessionHint";

describe("session hint domain", () => {
  test.each([
    ["app.teakvault.com", "teakvault.com"],
    ["APP.teakvault.com", "teakvault.com"],
    ["app.staging.teakvault.com", "staging.teakvault.com"],
  ])("shares %s's hint with %s", (host, domain) => {
    expect(sessionHintDomain(host)).toBe(domain);
  });
  test.each([
    "localhost",
    "127.0.0.1",
    "teak-git-branch.vercel.app",
    "app.localhost",
    "teakvault.com",
  ])("keeps %s's hint host-only", (host) => {
    expect(sessionHintDomain(host)).toBeUndefined();
  });
});
