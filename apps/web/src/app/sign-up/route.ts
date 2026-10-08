import type { NextRequest } from "next/server";
import { startWorkosAuth } from "@/lib/workos-auth-start";

export function GET(request: NextRequest): Promise<Response> {
  return startWorkosAuth(request, "sign-up");
}
