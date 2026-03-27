import { ConvexError } from "convex/values";
import { getMappingByClerkIdInDb } from "./userIdMappings";

type AuthIdentity = {
  subject: string;
  email?: string | null;
  name?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  nickname?: string | null;
  sessionId?: string | null;
};

const deriveDisplayName = (
  identity: AuthIdentity,
  fallbackEmail: string | null
): string | undefined => {
  if (identity.name?.trim()) {
    return identity.name.trim();
  }

  const fullName = [identity.givenName, identity.familyName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  if (fullName) {
    return fullName;
  }

  if (identity.nickname?.trim()) {
    return identity.nickname.trim();
  }

  const email = fallbackEmail?.trim();
  if (!email) {
    return undefined;
  }

  return email.split("@")[0]?.trim() || undefined;
};

export const resolveCurrentUserMapping = async (
  ctx: any,
  identity: AuthIdentity
) => {
  return getMappingByClerkIdInDb(ctx, identity.subject);
};

export const resolveCurrentAppUserId = async (
  ctx: any,
  identity: AuthIdentity
): Promise<string> => {
  const mapping = await resolveCurrentUserMapping(ctx, identity);
  return mapping?.betterAuthId ?? identity.subject;
};

export const getCurrentAuthUser = async (ctx: any) => {
  const identity = (await ctx.auth.getUserIdentity()) as AuthIdentity | null;
  if (!identity?.subject) {
    return null;
  }

  const mapping = await resolveCurrentUserMapping(ctx, identity);
  const userId = mapping?.betterAuthId ?? identity.subject;
  const email = identity.email?.trim() || mapping?.email || null;

  return {
    identity,
    mapping,
    userId,
    email,
    name: deriveDisplayName(identity, email),
  };
};

export const requireCurrentAuthUser = async (ctx: any) => {
  const user = await getCurrentAuthUser(ctx);
  if (!user) {
    throw new ConvexError("User must be authenticated");
  }
  return user;
};

export const requireCurrentUserId = async (ctx: any): Promise<string> => {
  const user = await requireCurrentAuthUser(ctx);
  return user.userId;
};
