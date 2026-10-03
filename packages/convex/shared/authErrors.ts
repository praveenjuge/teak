export const isSignUpDisabledError = (message: string): boolean =>
  /sign[_ -]?up(?:s)?[_ -]?(?:is[_ -]?)?(?:disabled|not enabled)|registration[_ -](?:is[_ -])?disabled/i.test(
    message
  );
