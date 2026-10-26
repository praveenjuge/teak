import { NextResponse } from "next/server";
import {
  SHARE_FILES_MISSING,
  SHARE_TEXT_FIELDS,
  type SharedText,
  shareLibraryPath,
} from "@/lib/share/sharedContent";

/**
 * The system share sheet posts here. The service worker normally answers
 * first; this runs when it didn't (it never installed, or the browser removed
 * it). The text still reaches the composer, but files can't follow a redirect,
 * so the library says they were lost.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const shared: SharedText = {};
  for (const field of SHARE_TEXT_FIELDS) {
    const value = form?.get(field);
    if (typeof value === "string") {
      shared[field] = value;
    }
  }
  const hadFiles =
    form === null ||
    form
      .getAll("files")
      .some((file) => typeof file !== "string" && file.size > 0);
  const path = shareLibraryPath(
    shared,
    hadFiles ? SHARE_FILES_MISSING : undefined
  );
  return NextResponse.redirect(new URL(path, request.url), 303);
}

export function GET(request: Request) {
  return NextResponse.redirect(new URL("/", request.url), 303);
}
