# Teak link fetcher: the Files Worker's internet-enabled Cloudflare Container.
# The build context is the repository root (image_build_context in
# wrangler.jsonc) so the server bundles Convex's SSRF policy, pinned fetch and
# image checks by path instead of copying them. Dockerfile.dockerignore keeps
# the context to the files listed below.
# Build: docker build --platform linux/amd64 -f apps/files-worker/fetcher/Dockerfile -t teak-fetcher .

FROM --platform=linux/amd64 oven/bun:1.4.2-alpine AS build
WORKDIR /build
# Installed at the context root so the Convex files below resolve them.
COPY apps/files-worker/fetcher/package.json apps/files-worker/fetcher/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY packages/files-protocol/src/remoteAsset.ts packages/files-protocol/src/
COPY packages/convex/linkMetadata/ssrf.ts packages/convex/linkMetadata/
COPY packages/convex/workflows/steps/pinnedFetch.ts packages/convex/workflows/steps/
COPY packages/convex/workflows/steps/linkMetadata/remoteImageDimensions.ts packages/convex/workflows/steps/linkMetadata/
COPY apps/files-worker/fetcher/src apps/files-worker/fetcher/src
RUN bun build apps/files-worker/fetcher/src/server.ts --target=node --minify --outfile /build/fetcher.mjs

# Matches the repo's pinned Node (root package.json engines).
FROM --platform=linux/amd64 node:24.21.0-alpine
RUN addgroup -S -g 10001 fetcher \
  && adduser -S -D -H -u 10001 -G fetcher fetcher
COPY --from=build /build/fetcher.mjs /app/fetcher.mjs
USER 10001:10001
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["node", "/app/fetcher.mjs"]
