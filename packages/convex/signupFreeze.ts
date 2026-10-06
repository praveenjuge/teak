import { APIError } from "better-auth/api";
import { isE2EEmail, normalizeE2EEmailDomain } from "./e2eAccounts";

import { SIGNUPS_PAUSED_MESSAGE } from "./shared/constants";

// This guard also covers native provider flows that bypass sign-up options.
export const guardUserCreation = ({
  email,
  disabled,
  e2eEmailDomain,
}: {
  email: string;
  disabled: boolean;
  e2eEmailDomain?: string;
}): Promise<void> => {
  if (!disabled) {
    return Promise.resolve();
  }
  if (e2eEmailDomain) {
    try {
      if (isE2EEmail(email, normalizeE2EEmailDomain(e2eEmailDomain))) {
        return Promise.resolve();
      }
    } catch {
      // Invalid automation configuration must never reopen public sign-ups.
    }
  }
  throw new APIError("FORBIDDEN", {
    code: "SIGN_UP_DISABLED",
    message: SIGNUPS_PAUSED_MESSAGE,
  });
};
