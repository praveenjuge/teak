FROM --platform=linux/amd64 oven/bun:1.4.2-alpine AS build
WORKDIR /build
COPY src ./src
RUN bun build --compile --minify --target=bun-linux-x64-musl src/server.ts --outfile /build/renderer

FROM --platform=linux/amd64 alpine:3.24.2
# PDFs often use the standard fonts (Helvetica, Times) without embedding
# them; the URW base 35 fonts are what poppler draws them with.
RUN apk add --no-cache ffmpeg poppler-utils font-urw-base35 util-linux-misc libstdc++ libgcc \
  && addgroup -S -g 10001 renderer \
  && adduser -S -D -H -u 10001 -G renderer -h /work renderer \
  && mkdir -p /work \
  && chown 10001:10001 /work \
  && chmod 700 /work
COPY --from=build /build/renderer /usr/local/bin/renderer
USER 10001:10001
WORKDIR /work
ENV PORT=8080 WORK_DIR=/work
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/renderer"]
