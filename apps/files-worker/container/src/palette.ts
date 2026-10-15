// Color palettes, shared by the Files Worker (still images) and this
// container (video and GIF frames). It is pure TypeScript with no runtime
// APIs so both bundles can import it; it lives here because the container
// image is built from this directory alone.
//
// Opaque pixels are binned at 5 bits per channel, the bins are clustered with
// weighted k-means in OKLab (where distance tracks how different two colors
// look), and clusters that would read as one color are merged. The palette
// takes the largest colors that differ from each other, so it spans the image
// instead of listing shades of its biggest area, and keeps one slot for a
// vivid accent that covers too little to rank on size alone.

export interface PaletteSwatch {
  hex: string;
  weight: number;
}

export const MAX_PALETTE_COLORS = 5;

const MAX_CLUSTERS = 12;
const MAX_ITERATIONS = 12;
const MIN_ALPHA = 128;
/** OKLab distance under which two colors read as one swatch. */
const MERGE_DISTANCE = 0.08;
const ACCENT_MIN_CHROMA = 0.12;
const ACCENT_MIN_WEIGHT = 0.01;
/** An accent's hue must be this far from every vivid pick's (30°). */
const ACCENT_MIN_HUE_GAP = Math.PI / 6;
/** Colors closer than this to one already picked count for less. */
const DISTINCT_DISTANCE = 0.25;

interface Lab {
  a: number;
  b: number;
  l: number;
}

interface Bin extends Lab {
  blue: number;
  green: number;
  red: number;
  weight: number;
}

interface Cluster extends Lab {
  /** Weighted sRGB sums; divided by `weight` for the swatch color. */
  blue: number;
  green: number;
  red: number;
  weight: number;
}

const toLinear = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.040_45 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const toOklab = (red: number, green: number, blue: number): Lab => {
  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);
  const l = Math.cbrt(
    0.412_221_470_8 * r + 0.536_332_536_3 * g + 0.051_445_992_9 * b
  );
  const m = Math.cbrt(
    0.211_903_498_2 * r + 0.680_699_545_1 * g + 0.107_396_956_6 * b
  );
  const s = Math.cbrt(
    0.088_302_461_9 * r + 0.281_718_837_6 * g + 0.629_978_700_5 * b
  );
  return {
    l: 0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    a: 1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
    b: 0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
  };
};

const distanceSquared = (left: Lab, right: Lab): number =>
  (left.l - right.l) ** 2 + (left.a - right.a) ** 2 + (left.b - right.b) ** 2;

const chroma = (color: Lab): number => Math.hypot(color.a, color.b);

const hueGap = (left: Lab, right: Lab): number => {
  const gap = Math.abs(
    Math.atan2(left.b, left.a) - Math.atan2(right.b, right.a)
  );
  return Math.min(gap, 2 * Math.PI - gap);
};

const toHex = (value: number): string =>
  Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, "0");

const binPixels = (pixels: Uint8Array): { bins: Bin[]; total: number } => {
  const sums = new Map<
    number,
    { b: number; g: number; n: number; r: number }
  >();
  let total = 0;
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    if ((pixels[offset + 3] as number) < MIN_ALPHA) {
      continue;
    }
    const r = pixels[offset] as number;
    const g = pixels[offset + 1] as number;
    const b = pixels[offset + 2] as number;
    const key =
      Math.floor(r / 8) * 1024 + Math.floor(g / 8) * 32 + Math.floor(b / 8);
    const sum = sums.get(key);
    if (sum) {
      sum.r += r;
      sum.g += g;
      sum.b += b;
      sum.n += 1;
    } else {
      sums.set(key, { r, g, b, n: 1 });
    }
    total += 1;
  }
  // Key order keeps the clustering deterministic for a given image.
  const bins = [...sums.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, sum]) => {
      const red = sum.r / sum.n;
      const green = sum.g / sum.n;
      const blue = sum.b / sum.n;
      return { ...toOklab(red, green, blue), red, green, blue, weight: sum.n };
    });
  return { bins, total };
};

const seedCenters = (bins: Bin[]): Lab[] => {
  let heaviest = bins[0] as Bin;
  for (const bin of bins) {
    if (bin.weight > heaviest.weight) {
      heaviest = bin;
    }
  }
  const centers: Lab[] = [heaviest];
  const nearest = bins.map((bin) => distanceSquared(bin, heaviest));
  const minSeparation = (MERGE_DISTANCE / 2) ** 2;
  while (centers.length < MAX_CLUSTERS) {
    let bestIndex = -1;
    let bestScore = 0;
    for (const [index, bin] of bins.entries()) {
      const distance = nearest[index] as number;
      const score = bin.weight * distance;
      if (distance > minSeparation && score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) {
      break;
    }
    const center = bins[bestIndex] as Bin;
    centers.push(center);
    for (const [index, bin] of bins.entries()) {
      nearest[index] = Math.min(
        nearest[index] as number,
        distanceSquared(bin, center)
      );
    }
  }
  return centers;
};

const nearestCenter = (color: Lab, centers: Lab[]): number => {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, center] of centers.entries()) {
    const distance = distanceSquared(color, center);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
};

const clusterBins = (bins: Bin[]): Cluster[] => {
  let centers = seedCenters(bins);
  let assignment = bins.map((bin) => nearestCenter(bin, centers));
  let clusters: Cluster[] = [];
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    clusters = centers.map(() => ({
      l: 0,
      a: 0,
      b: 0,
      red: 0,
      green: 0,
      blue: 0,
      weight: 0,
    }));
    for (const [index, bin] of bins.entries()) {
      const cluster = clusters[assignment[index] as number] as Cluster;
      cluster.l += bin.l * bin.weight;
      cluster.a += bin.a * bin.weight;
      cluster.b += bin.b * bin.weight;
      cluster.red += bin.red * bin.weight;
      cluster.green += bin.green * bin.weight;
      cluster.blue += bin.blue * bin.weight;
      cluster.weight += bin.weight;
    }
    clusters = clusters.filter((cluster) => cluster.weight > 0);
    for (const cluster of clusters) {
      cluster.l /= cluster.weight;
      cluster.a /= cluster.weight;
      cluster.b /= cluster.weight;
    }
    centers = clusters;
    const next = bins.map((bin) => nearestCenter(bin, centers));
    const settled = next.every((value, index) => value === assignment[index]);
    assignment = next;
    if (settled) {
      break;
    }
  }
  return clusters;
};

const mergeClose = (input: Cluster[]): Cluster[] => {
  const clusters = [...input];
  const limit = MERGE_DISTANCE ** 2;
  while (clusters.length > 1) {
    let pair: [number, number] | null = null;
    let closest = limit;
    for (let left = 0; left < clusters.length; left += 1) {
      for (let right = left + 1; right < clusters.length; right += 1) {
        const distance = distanceSquared(
          clusters[left] as Cluster,
          clusters[right] as Cluster
        );
        if (distance < closest) {
          closest = distance;
          pair = [left, right];
        }
      }
    }
    if (!pair) {
      break;
    }
    const keep = clusters[pair[0]] as Cluster;
    const drop = clusters[pair[1]] as Cluster;
    const weight = keep.weight + drop.weight;
    keep.l = (keep.l * keep.weight + drop.l * drop.weight) / weight;
    keep.a = (keep.a * keep.weight + drop.a * drop.weight) / weight;
    keep.b = (keep.b * keep.weight + drop.b * drop.weight) / weight;
    keep.red += drop.red;
    keep.green += drop.green;
    keep.blue += drop.blue;
    keep.weight = weight;
    clusters.splice(pair[1], 1);
  }
  return clusters;
};

const byWeight = (left: Cluster, right: Cluster): number =>
  right.weight - left.weight || left.l - right.l;

/**
 * Picks the largest colors, discounting each by how close it is to a color
 * already picked so the palette spans the image rather than listing shades
 * of one area; then swaps the most vivid leftover whose hue the other picks
 * lack in for the smallest one. Returned largest first.
 */
const rank = (clusters: Cluster[], maxColors: number, total: number) => {
  const remaining = [...clusters].sort(byWeight);
  const picks: Cluster[] = [];
  while (picks.length < maxColors && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -1;
    for (const [index, cluster] of remaining.entries()) {
      const nearest = Math.min(
        DISTINCT_DISTANCE,
        ...picks.map((pick) => Math.sqrt(distanceSquared(pick, cluster)))
      );
      const score = (cluster.weight * nearest) / DISTINCT_DISTANCE;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    picks.push(...remaining.splice(bestIndex, 1));
  }
  picks.sort(byWeight);
  // Leftovers are mostly shades of a color already kept, so the accent must
  // add a hue that no vivid pick beside it already has.
  const kept = picks.slice(0, -1);
  const accent = remaining
    .filter(
      (cluster) =>
        chroma(cluster) >= ACCENT_MIN_CHROMA &&
        cluster.weight / total >= ACCENT_MIN_WEIGHT &&
        !kept.some(
          (pick) =>
            chroma(pick) >= ACCENT_MIN_CHROMA &&
            hueGap(pick, cluster) < ACCENT_MIN_HUE_GAP
        )
    )
    .sort((left, right) => chroma(right) - chroma(left))[0];
  const smallest = picks.at(-1);
  if (
    accent &&
    smallest &&
    maxColors > 1 &&
    chroma(accent) > chroma(smallest)
  ) {
    picks[picks.length - 1] = accent;
    picks.sort(byWeight);
  }
  return picks;
};

/**
 * The image's main colors from RGBA bytes, largest share first. Pixels under
 * half opacity are ignored; an image with no opaque pixels has no palette.
 */
export const extractPalette = (
  pixels: Uint8Array,
  maxColors = MAX_PALETTE_COLORS
): PaletteSwatch[] => {
  const { bins, total } = binPixels(pixels);
  if (bins.length === 0 || maxColors < 1) {
    return [];
  }
  return rank(mergeClose(clusterBins(bins)), maxColors, total).map(
    (cluster) => ({
      hex: `#${toHex(cluster.red / cluster.weight)}${toHex(
        cluster.green / cluster.weight
      )}${toHex(cluster.blue / cluster.weight)}`.toUpperCase(),
      weight: cluster.weight / total,
    })
  );
};
