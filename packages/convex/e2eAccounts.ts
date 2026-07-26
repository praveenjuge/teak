export const normalizeE2EEmailDomain = (value: string): string => {
  const domain = value.trim().toLowerCase();
  const isValid =
    domain.length <= 253 &&
    domain.includes(".") &&
    !domain.includes("@") &&
    domain
      .split(".")
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (!isValid) {
    throw new Error("E2E_EMAIL_DOMAIN is invalid");
  }
  return domain;
};

export const isE2EEmail = (email: string, domain: string): boolean => {
  const normalized = email.trim().toLowerCase();
  const suffix = `@${domain}`;
  if (!normalized.endsWith(suffix)) {
    return false;
  }
  const localPart = normalized.slice(0, -suffix.length);
  return /^e2e-[a-z0-9][a-z0-9-]{0,100}$/.test(localPart);
};
