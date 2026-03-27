import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
  const authState = await auth({ acceptsToken: "session_token" });

  if (!authState.userId) {
    return NextResponse.json({ session: null, user: null });
  }

  const user = await currentUser();

  return NextResponse.json({
    session: {
      userId: authState.userId,
    },
    user: user
      ? {
          id: user.id,
          email: user.primaryEmailAddress?.emailAddress ?? null,
          name: user.fullName,
          image: user.imageUrl,
        }
      : null,
  });
}
