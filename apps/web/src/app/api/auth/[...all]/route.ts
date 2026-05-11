import { handler } from "@/lib/auth-server";

const { GET, POST: authPost } = handler;
export { GET };

export async function POST(req: Request, ctx: unknown) {
  const body = await req.arrayBuffer();
  const buffered = new Request(req, { body });
  return authPost(buffered, ctx);
}
