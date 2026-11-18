type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

// Bun's `typeof fetch` also requires `preconnect`.
export const asFetch = <Impl extends FetchImpl>(
  impl: Impl
): Impl & typeof fetch =>
  Object.assign(impl, { preconnect: () => undefined }) as Impl & typeof fetch;
