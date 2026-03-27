import { v } from "convex/values";

export const R2_REF_PREFIX = "r2:";

export const storageRefValidator = v.string();

export type StorageRef = string;

export const isR2StorageRef = (
  ref: StorageRef | null | undefined
): ref is StorageRef =>
  typeof ref === "string" && ref.startsWith(R2_REF_PREFIX);

export const toR2StorageRef = (key: string): StorageRef =>
  `${R2_REF_PREFIX}${key}`;

export const toR2ObjectKey = (ref: StorageRef): string =>
  ref.slice(R2_REF_PREFIX.length);
