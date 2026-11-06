/** A minimal Cloudflare v4 API client shared by the WAF and R2 scripts. */

const API = "https://api.cloudflare.com/client/v4";

interface CloudflareResponse<T> {
  errors?: { message: string }[];
  result: T;
  success: boolean;
}

export const cloudflareClient = (token: string, fetcher: typeof fetch) => {
  const call = async <T>(
    method: string,
    path: string,
    body?: unknown,
    options: { allowMissing?: boolean } = {}
  ): Promise<{ status: number; result: T | null }> => {
    // The origin is the fixed Cloudflare API; callers pass literal API paths.
    // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
    const response = await fetcher(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 404 && options.allowMissing) {
      return { status: 404, result: null };
    }
    const payload = (await response.json()) as CloudflareResponse<T>;
    if (!payload.success) {
      const reason = payload.errors?.map((error) => error.message).join("; ");
      throw new Error(`${method} ${path} failed: ${reason ?? response.status}`);
    }
    return { status: response.status, result: payload.result };
  };
  return { call };
};
