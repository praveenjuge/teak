/**
 * Convert the pinned Better Auth scrypt format into WorkOS's PHC format.
 * Better Auth uses the ASCII hex salt, not the decoded salt bytes, and
 * normalizes passwords with NFKC. Live WorkOS compatibility must be proven
 * with controlled accounts before the importer uses these hashes.
 * https://workos.com/docs/migrate/other-services#importing-passwords
 */
export function toWorkosPasswordHash(hash: string): string | null {
  if (!/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(hash)) {
    return null;
  }
  const salt = hash.slice(0, 32);
  const keyHex = hash.slice(33);
  let keyBytes = "";
  for (let offset = 0; offset < keyHex.length; offset += 2) {
    keyBytes += String.fromCharCode(
      Number.parseInt(keyHex.slice(offset, offset + 2), 16)
    );
  }
  const saltBase64 = btoa(salt).replace(/[=]+$/, "");
  const keyBase64 = btoa(keyBytes).replace(/[=]+$/, "");
  return `$scrypt$v=1$n=16384,r=16,p=1,kl=64$${saltBase64}$${keyBase64}`;
}
