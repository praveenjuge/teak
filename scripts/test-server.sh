#!/bin/bash
# Start the Convex backend in background and then the frontend
# This is used by Playwright's webServer

echo "[test-server] Starting Convex backend..."
bunx convex dev --until-success &
CONVEX_PID=$!

# Wait for Convex to be ready
echo "[test-server] Waiting for Convex..."
sleep 5

echo "[test-server] Starting Next.js frontend..."
bun run dev:frontend
