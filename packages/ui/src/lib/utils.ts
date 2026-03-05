import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const isAuthError = (error: unknown) => {
  const message =
    (typeof error === "object" &&
      error !== null &&
      "data" in error &&
      typeof (error as { data?: unknown }).data !== "undefined" &&
      String((error as { data?: unknown }).data)) ||
    (error instanceof Error && error.message) ||
    "";
  return /auth/i.test(message);
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
