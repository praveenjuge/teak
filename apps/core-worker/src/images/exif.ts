export interface ExifFacts {
  exposureTime?: number;
  fNumber?: number;
  focalLength?: number;
  iso?: number;
  make?: string;
  model?: string;
  /** Epoch ms. Without an EXIF offset the camera's local time is read as UTC. */
  takenAt?: number;
  /** The camera's clock time as epoch ms, read as if that clock were UTC. */
  takenAtClock?: number;
  /** Minutes east of UTC from the EXIF offset, when the camera recorded one. */
  takenAtOffset?: number;
}

export const EXIF_SCAN_BYTES = 256 * 1024;
const MAX_IFD_ENTRIES = 512;
const MAX_TEXT = 128;

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

interface Tiff {
  bytes: Uint8Array;
  little: boolean;
  view: DataView;
}

type IfdValue = number[] | string;

const TYPE_SIZES: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
  9: 4,
  10: 8,
};

const readIfd = (tiff: Tiff, offset: number): Map<number, IfdValue> => {
  const entries = new Map<number, IfdValue>();
  const { bytes, little, view } = tiff;
  if (offset < 8 || offset + 2 > bytes.length) {
    return entries;
  }
  const count = Math.min(view.getUint16(offset, little), MAX_IFD_ENTRIES);
  for (let index = 0; index < count; index++) {
    const entry = offset + 2 + index * 12;
    if (entry + 12 > bytes.length) {
      break;
    }
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const valueCount = view.getUint32(entry + 4, little);
    const size = TYPE_SIZES[type];
    if (!size || valueCount === 0 || valueCount > 1024) {
      continue;
    }
    const total = size * valueCount;
    const dataOffset =
      total <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
    if (dataOffset + total > bytes.length) {
      continue;
    }
    if (type === 2) {
      const text = ascii(bytes, dataOffset, Math.min(valueCount, MAX_TEXT));
      entries.set(tag, text.replace(/\0.*$/su, "").trim());
      continue;
    }
    const values: number[] = [];
    for (let item = 0; item < valueCount; item++) {
      const at = dataOffset + item * size;
      if (type === 3) {
        values.push(view.getUint16(at, little));
      } else if (type === 4) {
        values.push(view.getUint32(at, little));
      } else if (type === 9) {
        values.push(view.getInt32(at, little));
      } else if (type === 5 || type === 10) {
        const numerator =
          type === 5 ? view.getUint32(at, little) : view.getInt32(at, little);
        const denominator =
          type === 5
            ? view.getUint32(at + 4, little)
            : view.getInt32(at + 4, little);
        values.push(denominator === 0 ? Number.NaN : numerator / denominator);
      } else {
        values.push(bytes[at] as number);
      }
    }
    entries.set(tag, values);
  }
  return entries;
};

const numberOf = (value: IfdValue | undefined): number | undefined => {
  const first = Array.isArray(value) ? value[0] : undefined;
  return first !== undefined && Number.isFinite(first) && first > 0
    ? first
    : undefined;
};

const textOf = (value: IfdValue | undefined): string | undefined =>
  typeof value === "string" && value ? value : undefined;

const OFFSET = /^([+-])(\d{2}):(\d{2})$/u;

const clockTime = (original: string | undefined): number | undefined => {
  const match = original?.match(
    /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/u
  );
  if (!match) {
    return;
  }
  const parsed = Date.parse(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`
  );
  return Number.isFinite(parsed) ? parsed : undefined;
};

const offsetMinutes = (offset: string | undefined): number | undefined => {
  const match = offset?.match(OFFSET);
  const minutes = match ? Number(match[2]) * 60 + Number(match[3]) : Number.NaN;
  // Real zones run from UTC-12:00 to UTC+14:00.
  if (!match || Number(match[3]) > 59 || minutes > 14 * 60) {
    return;
  }
  return match[1] === "-" ? -minutes : minutes;
};

export const parseTiffExif = (bytes: Uint8Array): ExifFacts | null => {
  if (bytes.length < 8) {
    return null;
  }
  const order = ascii(bytes, 0, 2);
  if (order !== "II" && order !== "MM") {
    return null;
  }
  const little = order === "II";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(2, little) !== 42) {
    return null;
  }
  const tiff = { bytes, little, view };
  const ifd0 = readIfd(tiff, view.getUint32(4, little));
  const exifIfd = readIfd(tiff, numberOf(ifd0.get(0x87_69)) ?? 0);
  const original = textOf(exifIfd.get(0x90_03));
  const offset = textOf(exifIfd.get(0x90_11));
  const clock = clockTime(original);
  const zone = clock === undefined ? undefined : offsetMinutes(offset);
  const facts: ExifFacts = {
    exposureTime: numberOf(exifIfd.get(0x82_9a)),
    fNumber: numberOf(exifIfd.get(0x82_9d)),
    focalLength: numberOf(exifIfd.get(0x92_0a)),
    iso: numberOf(exifIfd.get(0x88_27)),
    make: textOf(ifd0.get(0x01_0f)),
    model: textOf(ifd0.get(0x01_10)),
    takenAt: clock === undefined ? undefined : clock - (zone ?? 0) * 60_000,
    takenAtClock: clock,
    takenAtOffset: zone,
  };
  const present = Object.fromEntries(
    Object.entries(facts).filter(([, value]) => value !== undefined)
  ) as ExifFacts;
  return Object.keys(present).length ? present : null;
};

const EXIF_MARKER = [0x45, 0x78, 0x69, 0x66, 0, 0];

const jpegExif = (bytes: Uint8Array): Uint8Array | null => {
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1] as number;
    if (marker === 0xda || marker === 0xd9) {
      break;
    }
    const length =
      (bytes[offset + 2] as number) * 256 + (bytes[offset + 3] as number);
    const body = offset + 4;
    if (
      marker === 0xe1 &&
      EXIF_MARKER.every((value, index) => bytes[body + index] === value)
    ) {
      return bytes.subarray(
        body + 6,
        Math.min(offset + 2 + length, bytes.length)
      );
    }
    offset += 2 + length;
  }
  return null;
};

interface IsoBox {
  body: number;
  end: number;
  type: string;
}

const isoChildren = (
  bytes: Uint8Array,
  start: number,
  end: number
): IsoBox[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size = view.getUint32(offset);
    if (size < 8 || offset + size > end) {
      break;
    }
    boxes.push({
      body: offset + 8,
      end: offset + size,
      type: ascii(bytes, offset + 4, 4),
    });
    offset += size;
  }
  return boxes;
};

export const heifExifLocation = (
  bytes: Uint8Array
): { length: number; offset: number } | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const meta = isoChildren(bytes, 0, bytes.length).find(
    (box) => box.type === "meta"
  );
  if (!meta) {
    return null;
  }
  // `meta` is a full box: skip version and flags.
  const children = isoChildren(bytes, meta.body + 4, meta.end);
  const iinf = children.find((box) => box.type === "iinf");
  const iloc = children.find((box) => box.type === "iloc");
  if (!(iinf && iloc)) {
    return null;
  }
  const iinfVersion = bytes[iinf.body] as number;
  let exifItem: number | null = null;
  for (const infe of isoChildren(
    bytes,
    iinf.body + (iinfVersion === 0 ? 6 : 8),
    iinf.end
  )) {
    const version = bytes[infe.body] as number;
    if (infe.type !== "infe" || version < 2) {
      continue;
    }
    const idSize = version === 2 ? 2 : 4;
    const itemId =
      idSize === 2
        ? view.getUint16(infe.body + 4)
        : view.getUint32(infe.body + 4);
    if (ascii(bytes, infe.body + 4 + idSize + 2, 4) === "Exif") {
      exifItem = itemId;
      break;
    }
  }
  if (exifItem === null) {
    return null;
  }
  const version = bytes[iloc.body] as number;
  let at = iloc.body + 4;
  const sizes = view.getUint16(at);
  at += 2;
  // Four 4-bit fields: offset, length, base offset and index sizes.
  const offsetSize = Math.floor(sizes / 4096);
  const lengthSize = Math.floor(sizes / 256) % 16;
  const baseSize = Math.floor(sizes / 16) % 16;
  const indexSize = version >= 1 ? sizes % 16 : 0;
  const readSized = (size: number): number => {
    let value = 0;
    for (let index = 0; index < size; index++) {
      value = value * 256 + (bytes[at + index] as number);
    }
    at += size;
    return value;
  };
  if (at + (version < 2 ? 2 : 4) > iloc.end) {
    return null;
  }
  const itemCount = version < 2 ? view.getUint16(at) : view.getUint32(at);
  at += version < 2 ? 2 : 4;
  const extentBytes = indexSize + offsetSize + lengthSize;
  for (let item = 0; item < itemCount && at < iloc.end; item++) {
    const itemId = readSized(version < 2 ? 2 : 4);
    if (version >= 1) {
      at += 2; // construction method
    }
    at += 2; // data reference index
    const base = readSized(baseSize);
    const extents = readSized(2);
    // Extents the box can't hold are a malformed file. Each one is skipped
    // in a step: walking 65,535 empty ones per item took tens of seconds.
    if (at + extents * extentBytes > iloc.end) {
      return null;
    }
    if (itemId === exifItem && extents > 0) {
      readSized(indexSize);
      const offset = readSized(offsetSize);
      const length = readSized(lengthSize);
      return { length, offset: base + offset };
    }
    at += extents * extentBytes;
  }
  return null;
};

/** HEIF `Exif` items start with a 4-byte offset to the TIFF header. */
export const heifExifPayload = (item: Uint8Array): Uint8Array | null => {
  if (item.length < 4) {
    return null;
  }
  const skip = new DataView(
    item.buffer,
    item.byteOffset,
    item.byteLength
  ).getUint32(0);
  return 4 + skip < item.length ? item.subarray(4 + skip) : null;
};

export const readExifFacts = async (
  read: (offset: number, length: number) => Promise<Uint8Array>,
  size: number
): Promise<ExifFacts | null> => {
  const head = await read(0, Math.min(EXIF_SCAN_BYTES, size));
  if (head[0] === 0xff && head[1] === 0xd8) {
    const tiff = jpegExif(head);
    return tiff ? parseTiffExif(tiff) : null;
  }
  if (ascii(head, 4, 4) === "ftyp") {
    const location = heifExifLocation(head);
    if (
      !location ||
      location.length > EXIF_SCAN_BYTES ||
      location.offset + location.length > size
    ) {
      return null;
    }
    const item =
      location.offset + location.length <= head.length
        ? head.subarray(location.offset, location.offset + location.length)
        : await read(location.offset, location.length);
    const tiff = heifExifPayload(item);
    return tiff ? parseTiffExif(tiff) : null;
  }
  return null;
};
