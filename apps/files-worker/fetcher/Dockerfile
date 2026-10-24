FROM --platform=linux/amd64 oven/bun:1.4.4-alpine AS build
WORKDIR /build
COPY apps/files-worker/fetcher/package.json apps/files-worker/fetcher/bun.lock ./
RUN bun install --frozen-lockfile --production
COPY packages/files-protocol/src packages/files-protocol/src
COPY packages/convex/linkMetadata/ssrf.ts packages/convex/linkMetadata/staticHtml.ts packages/convex/linkMetadata/types.ts packages/convex/linkMetadata/
COPY apps/files-worker/fetcher/src apps/files-worker/fetcher/src
RUN bun build apps/files-worker/fetcher/src/server.ts --target=node --minify --outfile /build/fetcher.mjs

FROM --platform=linux/amd64 node:24.21.0-alpine
RUN addgroup -S -g 10001 fetcher \
  && adduser -S -D -H -u 10001 -G fetcher fetcher
COPY --from=build /build/fetcher.mjs /app/fetcher.mjs
USER 10001:10001
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["node", "/app/fetcher.mjs"]
