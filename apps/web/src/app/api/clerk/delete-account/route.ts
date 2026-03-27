import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function DELETE() {
  const authState = await auth({ acceptsToken: "session_token" });

  if (!authState.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = await clerkClient();
  await client.users.deleteUser(authState.userId);

  return NextResponse.json({ ok: true });
}
