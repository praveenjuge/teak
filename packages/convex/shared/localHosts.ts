export const isLocalDevelopmentHostname = (hostname: string): boolean => {
  const normalizedHostname = hostname.trim().toLowerCase();
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname.endsWith(".localhost")
  );
};

export const isLocalDevelopmentUrl = (value: string): boolean => {
  try {
    return isLocalDevelopmentHostname(new URL(value).hostname);
  } catch {
    return false;
  }
};
