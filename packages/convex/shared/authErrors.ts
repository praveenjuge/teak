export const isSignUpDisabledError = (message: string): boolean =>
  /sign[_ -]?up(?:s)?[_ -]?(?:is[_ -]?)?(?:disabled|not enabled)|registration.*disabled/i.test(
    message
  );
