export const INSTAGRAM_HOSTNAME = "instagram.com";
export const INSTAGRAM_PRIMARY_IMAGE_MIN_DIM = 400;
export const INSTAGRAM_PRIMARY_IMAGE_WAIT_MS = 3000;

export const isInstagramHostname = (hostname: string): boolean =>
  hostname === INSTAGRAM_HOSTNAME || hostname.endsWith(`.${INSTAGRAM_HOSTNAME}`);

export const isInstagramUrl = (url: string): boolean => {
  try {
    return isInstagramHostname(new URL(url).hostname);
  } catch {
    return false;
  }
};

export const INSTAGRAM_PRIMARY_IMAGE_EVALUATOR = `
() => {
  const MIN_DIM = ${INSTAGRAM_PRIMARY_IMAGE_MIN_DIM};
  const viewportWidth = window.innerWidth || 0;
  const viewportHeight = window.innerHeight || 0;
  const root = document.querySelector("article") || document.querySelector("main") || document.body;
  const candidates = Array.from(root.querySelectorAll("img"))
    .map(img => {
      const src = img.currentSrc || img.src;
      const width = img.naturalWidth || 0;
      const height = img.naturalHeight || 0;
      const rect = img.getBoundingClientRect();
      const visibleWidth = Math.max(
        0,
        Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
      );
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
      );
      const visibleArea = visibleWidth * visibleHeight;
      return {
        src,
        width,
        height,
        area: width * height,
        rectTop: rect.top,
        visibleArea,
      };
    })
    .filter(img =>
      img.src &&
      (img.src.startsWith("http://") || img.src.startsWith("https://")) &&
      img.width >= MIN_DIM &&
      img.height >= MIN_DIM &&
      img.area > 0
    )
    .sort((a, b) => b.visibleArea - a.visibleArea || b.area - a.area);

  const visibleCandidates = candidates.filter(candidate => candidate.visibleArea > 0);
  const topFoldCandidates = candidates.filter(
    candidate => candidate.rectTop >= 0 && candidate.rectTop < viewportHeight * 1.5
  );

  const chosen =
    visibleCandidates[0] ??
    topFoldCandidates[0] ??
    candidates[0];

  if (!chosen) {
    return null;
  }

  return { url: chosen.src, width: chosen.width, height: chosen.height };
}
`;

export const buildInstagramPrimaryImageSnippet = (): string => `
      try {
        const hostname = new URL(page.url()).hostname;
        const isInstagram = hostname === "${INSTAGRAM_HOSTNAME}" || hostname.endsWith(".${INSTAGRAM_HOSTNAME}");
        if (isInstagram) {
          try {
            await page.waitForFunction(() => {
              return Array.from(document.images).some(img =>
                img.naturalWidth >= ${INSTAGRAM_PRIMARY_IMAGE_MIN_DIM} &&
                img.naturalHeight >= ${INSTAGRAM_PRIMARY_IMAGE_MIN_DIM}
              );
            }, { timeout: ${INSTAGRAM_PRIMARY_IMAGE_WAIT_MS} });
          } catch {}

          primaryImage = await page.evaluate(${INSTAGRAM_PRIMARY_IMAGE_EVALUATOR});
        }
      } catch {}
    `;
