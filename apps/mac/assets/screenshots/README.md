# Mac App Store screenshots

`source/01-library.png` through `source/10-document.png` are actual captures of
Teak for Mac and the included Safari extension, refreshed for 1.0.75. Preserve
the interface in these captures; the renderer only scales them proportionally
and adds a shadow and one short headline. `source/card-info.png` is an additional
reference capture, outside the App Store set.

`source/wallpaper-background.png` is the user's current public-domain Van Gogh
wallpaper, converted to PNG without desktop icons or other windows. No generated
or retouched application UI is used.

The App Store set covers the library, link detail, note editor, Safari saving,
and palette. Other captures remain in `source/` for reference.

`en-US/` contains five final 2880×1800 App Store images. The HTML/CSS frame is
rendered at 1440×900 with a 2× device scale using the repository's pinned
`playwright-core`. From the repository root:

```bash
node apps/mac/scripts/render-store-screenshots.mjs
asc screenshots validate --path apps/mac/assets/screenshots/en-US --device-type APP_DESKTOP
bun test apps/mac/tests/store-screenshots.test.ts
```

Rendering requires every capture and the background before changing outputs.
On macOS it uses installed Google Chrome. Set `MAC_SCREENSHOT_BROWSER` to
another Chromium executable if needed. The canonical Mac release workflow
publishes and verifies the ordered set before submission.
