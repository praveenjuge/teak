import { InspectSourceMissing } from "./zip";

/**
 * Container facts for stored audio and video, read with bounded ranged reads:
 * ISO BMFF (MP4, MOV, M4A) box headers and the `moov` box, or the WebM/Matroska
 * header up to the first cluster. Media bytes are never decoded.
 */
export interface MediaProbeResult {
  container: "mp4" | "mov" | "webm";
  durationSeconds: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  /** Display height, after any 90° or 270° track rotation. */
  height: number | null;
  /** First video track's codec: an ISO sample entry (`avc1`) or Matroska id. */
  videoCodec: string | null;
  width: number | null;
}

const HEADER_BYTES = 64 * 1024;
const MAX_TOP_LEVEL_BOXES = 64;
const MAX_MOOV_BYTES = 16 * 1024 * 1024;
const MAX_WEBM_HEADER_BYTES = 1024 * 1024;
const MAX_BOX_DEPTH = 8;

export class MediaProbeUnsupported extends Error {
  constructor() {
    super("media_probe_unsupported");
  }
}

type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

const readerFor =
  (bucket: R2Bucket, key: string, etag: string): RangeReader =>
  async (offset, length) => {
    const object = await bucket.get(key, { range: { offset, length } });
    if (!object) {
      throw new InspectSourceMissing();
    }
    if (object.httpEtag !== etag) {
      await object.body.cancel();
      throw new Error("source_changed");
    }
    return new Uint8Array(await object.arrayBuffer());
  };

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const u32 = (view: DataView, offset: number): number =>
  view.getUint32(offset, false);

const u64 = (view: DataView, offset: number): number => {
  const value = view.getBigUint64(offset, false);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MediaProbeUnsupported();
  }
  return Number(value);
};

const positive = (value: number): number | null =>
  Number.isFinite(value) && value > 0 ? value : null;

// --- ISO BMFF -------------------------------------------------------------

interface Box {
  /** Payload start, after the size/type header. */
  body: number;
  end: number;
  type: string;
}

/** Child boxes of `bytes[start, end)`. Truncated trailing boxes are ignored. */
const childBoxes = (bytes: Uint8Array, start: number, end: number): Box[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: Box[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = u32(view, offset);
    const type = ascii(bytes, offset + 4, 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) {
        break;
      }
      size = u64(view, offset + 8);
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) {
      break;
    }
    boxes.push({ body: offset + header, end: offset + size, type });
    offset += size;
  }
  return boxes;
};

const findChild = (
  bytes: Uint8Array,
  parent: Box,
  type: string
): Box | undefined =>
  childBoxes(bytes, parent.body, parent.end).find((box) => box.type === type);

const findPath = (
  bytes: Uint8Array,
  parent: Box,
  path: string[]
): Box | undefined => {
  let current: Box | undefined = parent;
  for (const type of path.slice(0, MAX_BOX_DEPTH)) {
    current = current ? findChild(bytes, current, type) : undefined;
  }
  return current;
};

interface TrackFacts {
  codec: string | null;
  handler: string;
  height: number | null;
  width: number | null;
}

const readTrack = (bytes: Uint8Array, trak: Box): TrackFacts | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hdlr = findPath(bytes, trak, ["mdia", "hdlr"]);
  if (!hdlr || hdlr.body + 12 > hdlr.end) {
    return null;
  }
  const handler = ascii(bytes, hdlr.body + 8, 4);
  let width: number | null = null;
  let height: number | null = null;
  const tkhd = findChild(bytes, trak, "tkhd");
  if (tkhd) {
    const version = bytes[tkhd.body];
    // version/flags, times, track id, reserved, duration, reserved, layer,
    // alternate group, volume, reserved; then the 3x3 matrix and 16.16 size.
    const matrix = tkhd.body + (version === 1 ? 52 : 40);
    if (matrix + 44 <= tkhd.end) {
      const a = view.getInt32(matrix, false) / 65_536;
      const b = view.getInt32(matrix + 4, false) / 65_536;
      const rawWidth = u32(view, matrix + 36) / 65_536;
      const rawHeight = u32(view, matrix + 40) / 65_536;
      const rotated = Math.abs(a) < 0.5 && Math.abs(Math.abs(b) - 1) < 0.01;
      width = positive(Math.round(rotated ? rawHeight : rawWidth));
      height = positive(Math.round(rotated ? rawWidth : rawHeight));
    }
  }
  let codec: string | null = null;
  const stsd = findPath(bytes, trak, ["mdia", "minf", "stbl", "stsd"]);
  if (stsd && stsd.body + 16 <= stsd.end) {
    codec = ascii(bytes, stsd.body + 12, 4).trim() || null;
  }
  return { codec, handler, height, width };
};

const parseMoov = (
  moovBytes: Uint8Array,
  container: "mp4" | "mov"
): MediaProbeResult => {
  const view = new DataView(
    moovBytes.buffer,
    moovBytes.byteOffset,
    moovBytes.byteLength
  );
  const moov: Box = { body: 0, end: moovBytes.length, type: "moov" };
  let durationSeconds: number | null = null;
  const mvhd = findChild(moovBytes, moov, "mvhd");
  if (mvhd) {
    const version = moovBytes[mvhd.body];
    const timescaleOffset = mvhd.body + (version === 1 ? 20 : 12);
    const durationOffset = timescaleOffset + 4;
    if (durationOffset + (version === 1 ? 8 : 4) <= mvhd.end) {
      const timescale = u32(view, timescaleOffset);
      const duration =
        version === 1 ? u64(view, durationOffset) : u32(view, durationOffset);
      // All-ones durations mean "unknown" (fragmented or live files).
      const unknown =
        version === 1
          ? duration >= Number.MAX_SAFE_INTEGER
          : duration === 0xff_ff_ff_ff;
      durationSeconds =
        timescale > 0 && !unknown ? positive(duration / timescale) : null;
    }
  }
  const tracks = childBoxes(moovBytes, moov.body, moov.end)
    .filter((box) => box.type === "trak")
    .map((trak) => readTrack(moovBytes, trak))
    .filter((track): track is TrackFacts => track !== null);
  const video = tracks.find((track) => track.handler === "vide");
  return {
    container,
    durationSeconds,
    hasAudio: tracks.some((track) => track.handler === "soun"),
    hasVideo: Boolean(video),
    height: video?.height ?? null,
    videoCodec: video?.codec ?? null,
    width: video?.width ?? null,
  };
};

const probeIsoBmff = async (
  read: RangeReader,
  size: number,
  head: Uint8Array
): Promise<MediaProbeResult> => {
  const brand = head.length >= 12 ? ascii(head, 8, 4) : "";
  const container = brand === "qt  " ? "mov" : "mp4";
  let offset = 0;
  for (
    let index = 0;
    index < MAX_TOP_LEVEL_BOXES && offset + 8 <= size;
    index++
  ) {
    const header =
      offset + 16 <= head.length
        ? head.subarray(offset, offset + 16)
        : await read(offset, Math.min(16, size - offset));
    const view = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength
    );
    let boxSize = u32(view, 0);
    const type = ascii(header, 4, 4);
    let headerSize = 8;
    if (boxSize === 1) {
      if (header.length < 16) {
        break;
      }
      boxSize = u64(view, 8);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = size - offset;
    }
    if (boxSize < headerSize || offset + boxSize > size) {
      break;
    }
    if (type === "moov") {
      const length = boxSize - headerSize;
      if (length > MAX_MOOV_BYTES) {
        throw new MediaProbeUnsupported();
      }
      const start = offset + headerSize;
      const bytes =
        start + length <= head.length
          ? head.slice(start, start + length)
          : await read(start, length);
      return parseMoov(bytes, container);
    }
    offset += boxSize;
  }
  throw new MediaProbeUnsupported();
};

// --- WebM / Matroska --------------------------------------------------------

const EBML_ID = 0x1a_45_df_a3;
const SEGMENT = 0x18_53_80_67;
const INFO = 0x15_49_a9_66;
const TRACKS = 0x16_54_ae_6b;
const CLUSTER = 0x1f_43_b6_75;
const TIMECODE_SCALE = 0x2a_d7_b1;
const DURATION = 0x44_89;
const TRACK_ENTRY = 0xae;
const TRACK_TYPE = 0x83;
const CODEC_ID = 0x86;
const VIDEO = 0xe0;
const PIXEL_WIDTH = 0xb0;
const PIXEL_HEIGHT = 0xba;
const DISPLAY_WIDTH = 0x54_b0;
const DISPLAY_HEIGHT = 0x54_ba;

interface EbmlElement {
  body: number;
  /** Body end; unknown-size elements extend to the end of the buffer. */
  end: number;
  id: number;
  next: number;
}

const readVint = (
  bytes: Uint8Array,
  offset: number,
  keepMarker: boolean
): { length: number; unknown: boolean; value: number } | null => {
  const first = bytes[offset];
  if (first === undefined || first === 0) {
    return null;
  }
  const length = Math.clz32(first) - 23;
  if (length > 8 || offset + length > bytes.length) {
    return null;
  }
  // The first byte's leading 1-bit marks the length; data bits follow it.
  const dataBits = 2 ** (8 - length);
  let value = keepMarker ? first : first % dataBits;
  let allOnes = value === dataBits - 1;
  for (let index = 1; index < length; index++) {
    const byte = bytes[offset + index] as number;
    value = value * 256 + byte;
    allOnes &&= byte === 0xff;
  }
  return { length, unknown: !keepMarker && allOnes, value };
};

const readElement = (
  bytes: Uint8Array,
  offset: number,
  limit: number
): EbmlElement | null => {
  const id = readVint(bytes, offset, true);
  if (!id) {
    return null;
  }
  const size = readVint(bytes, offset + id.length, false);
  if (!size) {
    return null;
  }
  const body = offset + id.length + size.length;
  const end = size.unknown ? limit : Math.min(body + size.value, limit);
  return {
    body,
    end,
    id: id.value,
    next: size.unknown ? limit : body + size.value,
  };
};

const ebmlChildren = (
  bytes: Uint8Array,
  start: number,
  end: number
): EbmlElement[] => {
  const elements: EbmlElement[] = [];
  let offset = start;
  while (offset < end) {
    const element = readElement(bytes, offset, end);
    if (!element || element.next <= offset) {
      break;
    }
    elements.push(element);
    if (element.id === CLUSTER) {
      break;
    }
    offset = element.next;
  }
  return elements;
};

const ebmlUint = (bytes: Uint8Array, element: EbmlElement): number => {
  let value = 0;
  for (let index = element.body; index < element.end; index++) {
    value = value * 256 + (bytes[index] as number);
  }
  return value;
};

const ebmlFloat = (bytes: Uint8Array, element: EbmlElement): number | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = element.end - element.body;
  if (length === 4) {
    return view.getFloat32(element.body, false);
  }
  if (length === 8) {
    return view.getFloat64(element.body, false);
  }
  return null;
};

const probeWebm = (bytes: Uint8Array): MediaProbeResult => {
  const top = ebmlChildren(bytes, 0, bytes.length);
  const segment = top.find((element) => element.id === SEGMENT);
  if (!segment) {
    throw new MediaProbeUnsupported();
  }
  let timecodeScale = 1_000_000;
  let rawDuration: number | null = null;
  let hasAudio = false;
  let video: {
    codec: string | null;
    height: number | null;
    width: number | null;
  } | null = null;
  for (const child of ebmlChildren(bytes, segment.body, segment.end)) {
    if (child.id === INFO) {
      for (const field of ebmlChildren(bytes, child.body, child.end)) {
        if (field.id === TIMECODE_SCALE) {
          timecodeScale = ebmlUint(bytes, field) || timecodeScale;
        } else if (field.id === DURATION) {
          rawDuration = ebmlFloat(bytes, field);
        }
      }
    } else if (child.id === TRACKS) {
      for (const entry of ebmlChildren(bytes, child.body, child.end)) {
        if (entry.id !== TRACK_ENTRY) {
          continue;
        }
        const fields = ebmlChildren(bytes, entry.body, entry.end);
        const type = fields.find((field) => field.id === TRACK_TYPE);
        const kind = type ? ebmlUint(bytes, type) : 0;
        if (kind === 2) {
          hasAudio = true;
        }
        if (kind !== 1 || video) {
          continue;
        }
        const codec = fields.find((field) => field.id === CODEC_ID);
        const videoElement = fields.find((field) => field.id === VIDEO);
        const dims = videoElement
          ? ebmlChildren(bytes, videoElement.body, videoElement.end)
          : [];
        const dim = (id: number) => {
          const element = dims.find((field) => field.id === id);
          return element ? positive(ebmlUint(bytes, element)) : null;
        };
        video = {
          codec: codec
            ? ascii(bytes, codec.body, codec.end - codec.body)
            : null,
          height: dim(DISPLAY_HEIGHT) ?? dim(PIXEL_HEIGHT),
          width: dim(DISPLAY_WIDTH) ?? dim(PIXEL_WIDTH),
        };
      }
    }
  }
  return {
    container: "webm",
    // MediaRecorder output usually omits Duration; leave it unknown then.
    durationSeconds:
      rawDuration === null
        ? null
        : positive((rawDuration * timecodeScale) / 1_000_000_000),
    hasAudio,
    hasVideo: Boolean(video),
    height: video?.height ?? null,
    videoCodec: video?.codec ?? null,
    width: video?.width ?? null,
  };
};

/** Probe a stored media object. Throws MediaProbeUnsupported for others. */
export const probeMedia = async (
  bucket: R2Bucket,
  key: string
): Promise<MediaProbeResult> => {
  const metadata = await bucket.head(key);
  if (!metadata) {
    throw new InspectSourceMissing();
  }
  const read = readerFor(bucket, key, metadata.httpEtag);
  const size = metadata.size;
  if (size < 12) {
    throw new MediaProbeUnsupported();
  }
  const head = await read(0, Math.min(HEADER_BYTES, size));
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (ascii(head, 4, 4) === "ftyp") {
    return await probeIsoBmff(read, size, head);
  }
  if (u32(view, 0) === EBML_ID) {
    const bytes =
      size <= head.length
        ? head
        : await read(0, Math.min(MAX_WEBM_HEADER_BYTES, size));
    return probeWebm(bytes);
  }
  throw new MediaProbeUnsupported();
};
