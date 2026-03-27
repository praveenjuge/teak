import { verifyWebhook } from "@clerk/backend/webhooks";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

type ClerkEmailAddress = {
  email_address?: string;
  id?: string;
};

type ClerkUserEventData = {
  email_addresses?: ClerkEmailAddress[];
  id?: string;
  primary_email_address_id?: string | null;
};

const getPrimaryEmailAddress = (data: ClerkUserEventData): string | null => {
  const emailAddresses = data.email_addresses ?? [];
  const primaryEmail = emailAddresses.find(
    (address) => address.id === data.primary_email_address_id
  );
  const fallbackEmail = emailAddresses[0];
  const email = primaryEmail?.email_address ?? fallbackEmail?.email_address;
  return email ? email.trim().toLowerCase() : null;
};

export const handleClerkUserWebhookRequest = async (
  ctx: any,
  request: Request
) => {
  const signingSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!signingSecret) {
    console.error("CLERK_WEBHOOK_SECRET is not configured");
    return new Response("Webhook not configured", { status: 500 });
  }

  let event: Awaited<ReturnType<typeof verifyWebhook>>;
  try {
    event = await verifyWebhook(request, { signingSecret });
  } catch (error) {
    console.error("Failed to verify Clerk webhook", error);
    return new Response("Webhook verification failed", { status: 400 });
  }

  const eventData = (event.data ?? {}) as ClerkUserEventData;
  const clerkId = eventData.id?.trim();
  const email = getPrimaryEmailAddress(eventData);

  if (
    (event.type === "user.created" || event.type === "user.updated") &&
    clerkId &&
    email
  ) {
    await ctx.runMutation((internal as any).userIdMappings.upsertClerkMapping, {
      clerkId,
      email,
    });
  } else if (event.type === "user.deleted") {
    console.log("Received Clerk user.deleted webhook", {
      clerkId,
    });
  } else {
    console.log("Skipping Clerk webhook event", {
      eventType: event.type,
      hasClerkId: Boolean(clerkId),
      hasEmail: Boolean(email),
    });
  }

  return new Response("OK", { status: 200 });
};

export const handleClerkUserWebhook = httpAction(handleClerkUserWebhookRequest);
