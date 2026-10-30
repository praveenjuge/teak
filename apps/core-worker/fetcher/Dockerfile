FROM --platform=linux/amd64 oven/bun:1.4.4-alpine AS build
WORKDIR /build
COPY apps/core-worker/fetcher/package.json apps/core-worker/fetcher/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY packages/files-protocol/src packages/files-protocol/src
COPY packages/convex/linkMetadata/ssrf.ts packages/convex/linkMetadata/staticHtml.ts packages/convex/linkMetadata/types.ts packages/convex/linkMetadata/
COPY apps/core-worker/fetcher/src apps/core-worker/fetcher/src
# pinnedFetch needs Bun 1.4.3+ (fetch with tls.serverName and proxy: false).
RUN bun build apps/core-worker/fetcher/src/server.ts --compile --minify --target=bun-linux-x64-musl --outfile /build/fetcher

FROM --platform=linux/amd64 alpine:3.24.2
# The compiled Bun binary links libstdc++ and libgcc, and carries its own
# root certificates for verifying upstream servers.
RUN apk add --no-cache libstdc++ libgcc \
  && addgroup -S -g 10001 fetcher \
  && adduser -S -D -H -u 10001 -G fetcher fetcher
COPY --from=build /build/fetcher /usr/local/bin/fetcher
USER 10001:10001
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/fetcher"]
