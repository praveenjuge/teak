import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
  const authState = await auth({ acceptsToken: "session_token" });

  if (!authState.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await authState.getToken({ template: "convex" });
  if (!token) {
    return NextResponse.json(
      { error: "Failed to create Convex token" },
      { status: 401 }
    );
  }

  return NextResponse.json({ token });
}
