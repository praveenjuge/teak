import { describe, expect, test } from "bun:test";
import {
  DEFAULT_INBOUND_EMAIL_DOMAIN,
  inboundEmailDomain,
  inboundSaveAddress,
  isSaveAddress,
} from "./inboundEmail";

describe("isSaveAddress", () => {
  test.each([
    ["save@in.teakvault.com", true],
    ["Save+Anything@In.TeakVault.com", true],
    ["SAVE@IN.TEAKVAULT.COM", true],
    ["save+@in.teakvault.com", true],
    ["<save@in.teakvault.com>", true],
    ["notes@in.teakvault.com", false],
    ["save.me@in.teakvault.com", false],
    ["save@teakvault.com", false],
    ["save@in-dev.teakvault.com", false],
    ["save@in.teakvault.com.evil.example", false],
    ["save@x@in.teakvault.com", false],
    ["", false],
  ])("%p is %p", (to, expected) => {
    expect(isSaveAddress(to, "in.teakvault.com")).toBe(expected);
  });

  test("the development domain is its own", () => {
    expect(
      isSaveAddress("save@in-dev.teakvault.com", "in-dev.teakvault.com")
    ).toBe(true);
  });
});

describe("inboundEmailDomain", () => {
  test.each([
    [undefined, DEFAULT_INBOUND_EMAIL_DOMAIN],
    ["", DEFAULT_INBOUND_EMAIL_DOMAIN],
    ["   ", DEFAULT_INBOUND_EMAIL_DOMAIN],
    [" In-Dev.TeakVault.com ", "in-dev.teakvault.com"],
  ])("%p is %p", (configured, expected) => {
    expect(inboundEmailDomain(configured)).toBe(expected);
  });

  test("the address Convex shows is one the Worker accepts", () => {
    const domain = inboundEmailDomain(" In.Example.com");
    expect(inboundSaveAddress(domain)).toBe("save@in.example.com");
    expect(isSaveAddress(inboundSaveAddress(domain), domain)).toBe(true);
  });
});
