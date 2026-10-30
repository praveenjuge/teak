// The one address everyone sends to: save@<domain>. Anything after a "+" is
// ignored, and letter case never matters.

export const DEFAULT_INBOUND_DOMAIN = "in.teakvault.com";

const SAVE_ADDRESS_REGEX = /^save(?:\+[^@]*)?@([^@]+)$/i;

export const isSaveAddress = (to: string, domain: string): boolean => {
  const address = to.trim().replace(/^<|>$/g, "");
  const match = SAVE_ADDRESS_REGEX.exec(address);
  return match?.[1]?.toLowerCase() === domain.trim().toLowerCase();
};
