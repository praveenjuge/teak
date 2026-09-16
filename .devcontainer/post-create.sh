#!/bin/sh
# Provision the Teak dev container through the same scripts developers run.
set -eu

BUN_VERSION="1.4.0"
if ! command -v bun > /dev/null 2>&1; then
  curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip" -o /tmp/bun.zip
  python3 -c "import zipfile; zipfile.ZipFile('/tmp/bun.zip').extract('bun-linux-x64/bun', '/tmp')"
  sudo install -m 0755 /tmp/bun-linux-x64/bun /usr/local/bin/bun
fi
bun --version
node --version

CONVEX_AGENT_MODE=anonymous bun run setup --target web --convex local
echo "Container ready. Diagnose with: bun run doctor --target web --profile local"
