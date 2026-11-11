import { isSameUserNamespace, isValidObjectKey } from "@teak/files-protocol";
import { InvalidOpInput } from "./opFailure";

export type RawOpParams = Record<string, unknown>;

export const requiredString = (params: RawOpParams, key: string): string => {
  const value = params[key];
  if (typeof value !== "string" || !value) {
    throw new InvalidOpInput(`invalid_${key}`);
  }
  return value;
};

export const optionalString = (
  params: RawOpParams,
  key: string
): string | null => {
  const value = params[key];
  return typeof value === "string" && value ? value : null;
};

/** An object key under one of the bucket's roots, or INVALID_INPUT. */
export const objectKeyParam = (params: RawOpParams, name = "key"): string => {
  const key = requiredString(params, name);
  if (!isValidObjectKey(key)) {
    throw new InvalidOpInput("invalid_storage_key");
  }
  return key;
};

/** A source and a different destination in the same user's folder. */
export const derivedKeyParams = (params: RawOpParams) => {
  const sourceKey = objectKeyParam(params, "sourceKey");
  const destinationKey = objectKeyParam(params, "destinationKey");
  if (
    !isSameUserNamespace(sourceKey, destinationKey) ||
    sourceKey === destinationKey
  ) {
    throw new InvalidOpInput("invalid_storage_key");
  }
  return { destinationKey, sourceKey };
};

/** One more destination beside `derivedKeyParams`', when it is set. */
export const optionalDerivedKey = (
  params: RawOpParams,
  name: string,
  keys: { destinationKey: string; sourceKey: string }
): string | null => {
  const value = params[name];
  if (value === undefined || value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    !isValidObjectKey(value) ||
    !isSameUserNamespace(keys.sourceKey, value) ||
    value === keys.sourceKey ||
    value === keys.destinationKey
  ) {
    throw new InvalidOpInput("invalid_storage_key");
  }
  return value;
};

/** A title the AI ops read, at most 2,000 characters. */
export const optionalTitle = (params: RawOpParams): string | null => {
  const title = optionalString(params, "title");
  if (title !== null && title.length > 2000) {
    throw new InvalidOpInput("invalid_title");
  }
  return title;
};
