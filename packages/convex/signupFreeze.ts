import { isE2EEmail, normalizeE2EEmailDomain } from "./e2eAccounts";

// This guard also covers native provider flows that bypass sign-up options.
export const userCreationAllowed = ({
  email,
  disabled,
  e2eEmailDomain,
}: {
  email: string;
  disabled: boolean;
  e2eEmailDomain?: string;
}): boolean => {
  if (!disabled) {
    return true;
  }
  if (e2eEmailDomain) {
    try {
      return isE2EEmail(email, normalizeE2EEmailDomain(e2eEmailDomain));
    } catch {
      // Invalid automation configuration must never reopen public sign-ups.
    }
  }
  return false;
};
