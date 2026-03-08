# Deploy Extension to Chrome Web Store

## 1. Increment Version

Edit the root `package.json` version and push to `main`. The version sync workflow will update `wxt.config.ts` and the extension package manifest automatically.

After the sync commit lands, build the extension from the updated repo state.

## 2. Build & Create ZIP

```bash
bun run zip
```

This creates `.output/teak-archive-{version}.zip`.

## 3. Deploy Convex Backend (if you have schema/function changes)

```bash
cd /Users/praveenjuge/Projects/teak
bunx convex deploy
```

## 4. Upload to Chrome Web Store

1. Go to https://chrome.google.com/webstore/devconsole
2. Select the Teak extension
3. Upload the ZIP file from step 2
4. Update store listing if needed
5. Submit for review
