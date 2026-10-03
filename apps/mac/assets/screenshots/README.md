# Mac App Store screenshots

`source/01-library.png` through `source/05-safari.png` are actual app and Safari
window captures. Keep these files unchanged. The renderer places them over the
background, scales them proportionally, and adds a shadow and short captions;
it does not recreate or retouch the app interface.

`source/wallpaper-background.png` is an image_gen derivative that softens the
user's current public-domain Van Gogh wallpaper. The original wallpaper is
`/Users/praveenjuge/Downloads/507513ld.jpg`; it is not duplicated here. AI generation
was used only for the background, never for app captures.

`en-US/` contains the final 2880×1800 App Store images. The HTML/CSS frame is
rendered at 1440×900 with a 2× device scale using the repository's pinned
`playwright-core`. From the repository root:

```bash
node apps/mac/scripts/render-store-screenshots.mjs
asc screenshots validate --path apps/mac/assets/screenshots/en-US --device-type APP_DESKTOP
```

Rendering requires all five captures and the background before changing any
outputs. On macOS it uses installed Google Chrome. Set `MAC_SCREENSHOT_BROWSER`
to another Chromium executable if needed. The canonical Mac release workflow
publishes and verifies the final ordered screenshot set before submission.
