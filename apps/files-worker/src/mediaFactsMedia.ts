/** Video and audio container parsers. Malformed input returns null; callers fall back to a weaker verification level. */

import { ascii, type MediaFacts, u16be, u32be, u32le } from "./mediaBytes";
import {
  isAacAdts,
  isEbml,
  isFlac,
  isIsobmff,
  isMatroska,
  isMp3,
  isOgg,
  isobmffBrand,
  isWav,
} from "./mediaDetect";

interface IsobmffBox {
  end: number;
  start: number;
  type: string;
}

const readBoxes = (
  bytes: Uint8Array,
  start: number,
  end: number,
  limit = 64
): IsobmffBox[] => {
  const boxes: IsobmffBox[] = [];
  let offset = start;
  while (offset + 8 <= end && boxes.length < limit) {
    let size = u32be(bytes, offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) {
        break;
      }
      const high = u32be(bytes, offset + 8);
      const low = u32be(bytes, offset + 12);
      if (high > 0 || low < 16) {
        break;
      }
      size = low;
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) {
      break;
    }
    boxes.push({
      end: offset + size,
      start: offset + header,
      type: ascii(bytes, offset + 4, 4),
    });
    offset += size;
  }
  return boxes;
};

export const parseIsobmffFacts = (bytes: Uint8Array): MediaFacts | null => {
  if (!isIsobmff(bytes)) {
    return null;
  }
  const facts: MediaFacts = { container: "isobmff" };
  const brand = isobmffBrand(bytes);
  if (brand === "qt  ") {
    facts.container = "mov";
  } else if (brand === "M4A " || brand === "M4B ") {
    facts.container = "m4a";
  } else if (brand) {
    facts.container = "mp4";
  }
  for (const box of readBoxes(bytes, 0, bytes.length)) {
    if (box.type !== "moov") {
      continue;
    }
    for (const child of readBoxes(bytes, box.start, box.end)) {
      if (child.type === "mvhd" && child.end - child.start >= 20) {
        const version = bytes[child.start] ?? 0;
        const timescale =
          version === 1
            ? u32be(bytes, child.start + 20)
            : u32be(bytes, child.start + 12);
        const duration =
          version === 1
            ? u32be(bytes, child.start + 28)
            : u32be(bytes, child.start + 16);
        if (timescale > 0 && duration > 0) {
          facts.duration = duration / timescale;
        }
      }
      if (child.type === "trak") {
        for (const track of readBoxes(bytes, child.start, child.end)) {
          if (track.type === "tkhd" && track.end - track.start >= 84) {
            const version = bytes[track.start] ?? 0;
            const base = track.start + (version === 1 ? 88 : 76);
            const width = u32be(bytes, base) / 65_536;
            const height = u32be(bytes, base + 4) / 65_536;
            if (width > 0 && height > 0 && facts.width === undefined) {
              facts.width = Math.round(width);
              facts.height = Math.round(height);
            }
          }
          if (track.type === "mdia") {
            for (const media of readBoxes(bytes, track.start, track.end)) {
              if (media.type !== "minf") {
                continue;
              }
              for (const table of readBoxes(bytes, media.start, media.end)) {
                if (table.type !== "stbl") {
                  continue;
                }
                for (const sample of readBoxes(bytes, table.start, table.end)) {
                  if (sample.type === "stsd" && facts.codec === undefined) {
                    for (const entry of readBoxes(
                      bytes,
                      sample.start + 8,
                      sample.end,
                      4
                    )) {
                      facts.codec = entry.type.trim() || undefined;
                      break;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    break;
  }
  return facts;
};

const readEbmlVint = (
  bytes: Uint8Array,
  offset: number
): { length: number; value: number } | null => {
  const first = bytes[offset];
  if (first === undefined) {
    return null;
  }
  let mask = 0x80;
  let length = 1;
  while (length <= 8 && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > bytes.length) {
    return null;
  }
  let value = first & (mask - 1);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + (bytes[offset + index] ?? 0);
  }
  return { length, value };
};

const readEbmlId = (
  bytes: Uint8Array,
  offset: number
): { length: number; value: number } | null => {
  const first = bytes[offset];
  if (first === undefined) {
    return null;
  }
  let mask = 0x80;
  let length = 1;
  while (length <= 4 && (first & mask) === 0) {
    mask >>= 1;
    length += 1;
  }
  if (length > 4 || offset + length > bytes.length) {
    return null;
  }
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = value * 256 + (bytes[offset + index] ?? 0);
  }
  return { length, value };
};

export const parseEbmlFacts = (bytes: Uint8Array): MediaFacts | null => {
  if (!isEbml(bytes)) {
    return null;
  }
  const facts: MediaFacts = {
    container: isMatroska(bytes) ? "matroska" : "webm",
  };
  let timecodeScale = 1_000_000;
  let duration: number | undefined;
  const walk = (
    start: number,
    end: number,
    depth: number,
    inTrackEntry: boolean
  ): void => {
    if (depth > 6) {
      return;
    }
    let offset = start;
    let elements = 0;
    while (offset < end && elements < 128) {
      elements += 1;
      const id = readEbmlId(bytes, offset);
      const size = id ? readEbmlVint(bytes, offset + id.length) : null;
      if (!(id && size)) {
        return;
      }
      const dataStart = offset + id.length + size.length;
      // Unknown-size elements (all bits set) extend to the parent end.
      const dataEnd =
        size.value === 2 ** (7 * size.length) - 1
          ? end
          : Math.min(end, dataStart + size.value);
      if (dataStart > dataEnd) {
        return;
      }
      if (id.value === 0x2a_d7_b1) {
        timecodeScale = 0;
        for (let index = dataStart; index < dataEnd; index += 1) {
          timecodeScale = timecodeScale * 256 + (bytes[index] ?? 0);
        }
      } else if (id.value === 0x44_89 && dataEnd - dataStart === 8) {
        const view = new DataView(
          bytes.buffer,
          bytes.byteOffset + dataStart,
          8
        );
        duration = view.getFloat64(0);
      } else if (id.value === 0xae) {
        walk(dataStart, dataEnd, depth + 1, true);
      } else if (
        id.value === 0xb0 &&
        inTrackEntry &&
        facts.width === undefined
      ) {
        let value = 0;
        for (let index = dataStart; index < dataEnd; index += 1) {
          value = value * 256 + (bytes[index] ?? 0);
        }
        if (value > 0) {
          facts.width = value;
        }
      } else if (
        id.value === 0xba &&
        inTrackEntry &&
        facts.height === undefined
      ) {
        let value = 0;
        for (let index = dataStart; index < dataEnd; index += 1) {
          value = value * 256 + (bytes[index] ?? 0);
        }
        if (value > 0) {
          facts.height = value;
        }
      } else if (
        id.value === 0x86 &&
        inTrackEntry &&
        facts.codec === undefined
      ) {
        const codec = ascii(bytes, dataStart, dataEnd - dataStart).replace(
          /\0+$/,
          ""
        );
        if (codec) {
          facts.codec = codec;
        }
      } else if (
        id.value === 0x18_53_80_67 ||
        id.value === 0x15_49_a9_66 ||
        id.value === 0x16_54_ae_6b
      ) {
        walk(dataStart, dataEnd, depth + 1, inTrackEntry);
      }
      if (dataEnd <= offset) {
        return;
      }
      offset = dataEnd;
    }
  };
  walk(0, bytes.length, 0, false);
  if (duration !== undefined && timecodeScale > 0) {
    facts.duration = (duration * timecodeScale) / 1_000_000_000;
  }
  return facts;
};

const MP3_BITRATES = [
  [0, 0, 0, 0, 0],
  [32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  [32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
];

const MP3_SAMPLE_RATES = [
  [44_100, 22_050, 11_025],
  [48_000, 24_000, 12_000],
  [32_000, 16_000, 8000],
];

export const parseMp3Facts = (bytes: Uint8Array): MediaFacts | null => {
  let offset = 0;
  if (ascii(bytes, 0, 3) === "ID3" && bytes.length >= 10) {
    const size =
      ((bytes[6] ?? 0) << 21) |
      ((bytes[7] ?? 0) << 14) |
      ((bytes[8] ?? 0) << 7) |
      (bytes[9] ?? 0);
    offset = 10 + size;
  }
  if (offset + 4 > bytes.length || !isMp3(bytes.subarray(offset))) {
    return null;
  }
  const facts: MediaFacts = { codec: "mp3", container: "mp3" };
  const header = bytes[offset + 2] ?? 0;
  const version = (bytes[offset + 1] ?? 0) & 0x18;
  const layer = (bytes[offset + 1] ?? 0) & 0x06;
  const bitrateIndex = (header >> 4) & 0x0f;
  const rateIndex = (header >> 2) & 0x03;
  let versionRow = 2;
  if (version === 0x18) {
    versionRow = 0;
  } else if (version === 0x10) {
    versionRow = 1;
  }
  let bitrateRow = 3;
  if (layer === 0x04) {
    bitrateRow = 1;
  } else if (versionRow === 0) {
    bitrateRow = 2;
  }
  const bitrate =
    layer === 0x06 ? undefined : MP3_BITRATES[bitrateRow]?.[bitrateIndex - 1];
  const sampleRate = MP3_SAMPLE_RATES[versionRow]?.[rateIndex];
  if (!(bitrate && sampleRate)) {
    return facts;
  }
  // Xing/Info header follows the frame header plus side info.
  const channels = (bytes[offset + 3] ?? 0) >> 6 === 3 ? 1 : 2;
  const monoSideInfo = versionRow === 0 ? 17 : 9;
  const stereoSideInfo = versionRow === 0 ? 32 : 17;
  const sideInfo = channels === 1 ? monoSideInfo : stereoSideInfo;
  const xingOffset = offset + 4 + sideInfo;
  const tag = ascii(bytes, xingOffset, 4);
  if (tag !== "Xing" && tag !== "Info") {
    return facts;
  }
  const flags = u32be(bytes, xingOffset + 4);
  if ((flags & 0x01) === 0) {
    return facts;
  }
  const frames = u32be(bytes, xingOffset + 8);
  const samplesPerFrame = layer === 0x04 || versionRow === 0 ? 1152 : 576;
  if (frames > 0 && frames < 10_000_000) {
    facts.duration = (frames * samplesPerFrame) / sampleRate;
  }
  return facts;
};

export const parseWavFacts = (
  bytes: Uint8Array,
  fileSize?: number
): MediaFacts | null => {
  if (!isWav(bytes) || bytes.length < 28) {
    return null;
  }
  const facts: MediaFacts = { codec: "pcm", container: "wav" };
  let offset = 12;
  let byteRate = 0;
  let dataBytes = 0;
  for (let chunks = 0; chunks < 32 && offset + 8 <= bytes.length; chunks += 1) {
    const id = ascii(bytes, offset, 4);
    const size = u32le(bytes, offset + 4);
    if (size > (fileSize ?? bytes.length)) {
      break;
    }
    if (id === "fmt " && size >= 16 && offset + 28 <= bytes.length) {
      byteRate = u32le(bytes, offset + 16);
      const audioFormat =
        (bytes[offset + 8] ?? 0) | ((bytes[offset + 9] ?? 0) << 8);
      if (
        audioFormat !== 1 &&
        audioFormat !== 3 &&
        audioFormat !== 6 &&
        audioFormat !== 7
      ) {
        facts.codec = `wav-format-${audioFormat}`;
      }
    } else if (id === "data") {
      dataBytes =
        fileSize === undefined ? size : Math.min(size, fileSize - offset - 8);
    }
    offset += 8 + size + (size % 2);
  }
  if (byteRate > 0 && dataBytes > 0) {
    facts.duration = dataBytes / byteRate;
  }
  return facts;
};

export const parseFlacFacts = (bytes: Uint8Array): MediaFacts | null => {
  if (!isFlac(bytes) || bytes.length < 42) {
    return null;
  }
  const facts: MediaFacts = { codec: "flac", container: "flac" };
  if ((bytes[4] ?? 0) !== 0x10 || u16be(bytes, 6) !== 34) {
    return facts;
  }
  const sampleRate = (u32be(bytes, 10) >> 12) & 0xf_ff_ff;
  const totalSamples =
    ((u32be(bytes, 14) & 0x0f) * 0x1_00_00_00_00 + u32be(bytes, 18)) >>> 0;
  if (sampleRate > 0 && totalSamples > 0) {
    facts.duration = totalSamples / sampleRate;
  }
  return facts;
};

export const parseOggFacts = (
  head: Uint8Array,
  tail?: Uint8Array
): MediaFacts | null => {
  if (!isOgg(head)) {
    return null;
  }
  const facts: MediaFacts = { container: "ogg" };
  // First pages carry the BOS identification packets.
  let offset = 0;
  let sampleRate = 0;
  for (let pages = 0; pages < 4 && offset + 27 <= head.length; pages += 1) {
    if (ascii(head, offset, 4) !== "OggS") {
      break;
    }
    const segments = head[offset + 26] ?? 0;
    if (offset + 27 + segments > head.length) {
      break;
    }
    let packetSize = 0;
    for (let index = 0; index < segments; index += 1) {
      packetSize += head[offset + 27 + index] ?? 0;
    }
    const packet = offset + 27 + segments;
    if (packet + packetSize > head.length) {
      break;
    }
    if (pages === 0) {
      const magic = ascii(head, packet + 1, 6);
      if (head[packet] === 1 && magic === "vorbis" && packetSize >= 30) {
        facts.codec = "vorbis";
        sampleRate = u32le(head, packet + 12);
      } else if (ascii(head, packet, 8) === "OpusHead" && packetSize >= 18) {
        facts.codec = "opus";
        sampleRate = 48_000;
      } else if (ascii(head, packet + 1, 4) === "FLAC") {
        facts.codec = "flac";
      }
    }
    offset = packet + packetSize;
  }
  // Duration comes from the last page granule position.
  const tailBytes = tail ?? head;
  for (
    let scan = tailBytes.length - 27;
    scan >= 0 && scan >= tailBytes.length - 65_587;
    scan -= 1
  ) {
    if (ascii(tailBytes, scan, 4) !== "OggS") {
      continue;
    }
    const granule =
      u32le(tailBytes, scan + 6) +
      u32le(tailBytes, scan + 10) * 0x1_00_00_00_00;
    if (sampleRate > 0 && granule > 0) {
      facts.duration = granule / sampleRate;
    }
    break;
  }
  return facts;
};

export const parseAacFacts = (bytes: Uint8Array): MediaFacts | null => {
  if (!isAacAdts(bytes)) {
    return null;
  }
  const sampleRates = [
    96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000,
    12_000, 11_025, 8000, 7350,
  ];
  const rateIndex = ((bytes[2] ?? 0) >> 2) & 0x0f;
  if (rateIndex > 12) {
    return { codec: "aac", container: "adts" };
  }
  void sampleRates[rateIndex];
  return { codec: "aac", container: "adts" };
};
