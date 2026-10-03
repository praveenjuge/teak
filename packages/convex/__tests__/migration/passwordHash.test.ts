import { describe, expect, test } from "bun:test";
import { scrypt, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { toWorkosPasswordHash } from "../../migration/passwordHash";

// Parse and verify independently of the converter and Better Auth verifier.
async function verifyPhc(phc: string, password: string): Promise<boolean> {
  const [, algorithm, version, parameters, salt, expectedKey] = phc.split("$");
  if (algorithm !== "scrypt" || version !== "v=1") {
    throw new Error("Unsupported PHC format");
  }
  const settings = Object.fromEntries(
    parameters.split(",").map((entry) => {
      const [key, value] = entry.split("=");
      return [key, Number(value)];
    })
  );
  const actualKey = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      Buffer.from(salt, "base64"),
      settings.kl,
      {
        N: settings.n,
        r: settings.r,
        p: settings.p,
        maxmem: 128 * 1024 * 1024,
      },
      (error, key) => (error ? reject(error) : resolve(key))
    );
  });
  return timingSafeEqual(actualKey, Buffer.from(expectedKey, "base64"));
}

describe("Better Auth password migration", () => {
  test.each([
    ["ASCII", "Teak-test-password-42!"],
    ["accented Latin", "café-déjà-vu-42!"],
    ["NFKC-changing text", "Ｔｅａｋ-ﬁ-①-password!"],
    ["emoji", "Teak-🌳🔐-password!"],
  ])(
    "preserves %s credentials with the legacy normalization",
    async (_: string, password: string) => {
      const originalHash = await hashPassword(password);
      const phc = toWorkosPasswordHash(originalHash);
      expect(phc).not.toBeNull();
      if (!phc) {
        throw new Error("Expected a converted hash");
      }
      expect(await verifyPhc(phc, password.normalize("NFKC"))).toBe(true);
      expect(await verifyPhc(phc, "wrong-password")).toBe(false);
      for (const field of phc.split("$").slice(4)) {
        expect(field).not.toContain("=");
      }
    }
  );

  test("requires provider normalization for passwords changed by NFKC", async () => {
    const password = "Ｔｅａｋ-ﬁ-①-password!";
    const phc = toWorkosPasswordHash(await hashPassword(password));
    if (!phc) {
      throw new Error("Expected a converted hash");
    }
    expect(await verifyPhc(phc, password)).toBe(false);
    expect(await verifyPhc(phc, password.normalize("NFKC"))).toBe(true);
  });

  test.each([
    "",
    "not-a-hash",
    `${"a".repeat(31)}:${"b".repeat(128)}`,
    `${"a".repeat(32)}:${"b".repeat(127)}`,
    `${"A".repeat(32)}:${"b".repeat(128)}`,
    `${"g".repeat(32)}:${"b".repeat(128)}`,
    `${"a".repeat(32)}:${"b".repeat(128)}:extra`,
    "$scrypt$v=1$n=16384,r=8,p=1,kl=64$salt$key",
  ])(
    "refuses unsupported hashes without exposing their contents",
    (hash: string) => {
      expect(toWorkosPasswordHash(hash)).toBeNull();
    }
  );
});
