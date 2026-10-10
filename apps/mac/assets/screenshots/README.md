# Mac App Store screenshots

`source/` holds real captures of Teak for Mac and its Safari extension;
`en-US/` holds the six final 2880 × 1800 App Store images, in order. Both come
from the shared store images pipeline in
[`scripts/store-assets`](../../../../scripts/store-assets/README.md), which also
makes the iPhone and Play Store images.

```bash
bun scripts/store-assets/render.ts mac
```

`source/06-safari.png` is the Safari extension capture from 1.0.75; every other
capture was refreshed for 1.0.85.
