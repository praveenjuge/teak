import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { FakeBucket } from "./testsupport";
import { findEocd, readZipDirectory, readZipEntry } from "./zip";

const key = "users/u/imports/job/source.zip";
const bucketFor = (bytes: Uint8Array) => {
  const bucket = new FakeBucket();
  bucket.objects.set(key, { bytes });
  return bucket as unknown as R2Bucket;
};
const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

describe("shared ranged ZIP reader", () => {
  test("reads a ZIP64 directory and local header beyond 4 GiB without buffering the archive", async () => {
    const original = zipSync(
      { "manifest.json": strToU8('{"version":1,"cards":[]}') },
      { level: 0 }
    );
    const eocd = findEocd(original)!;
    const local = original.subarray(0, eocd.cdOffset);
    const central = new Uint8Array(eocd.cdSize + 12);
    central.set(original.subarray(eocd.cdOffset, eocd.cdOffset + eocd.cdSize));
    const centralView = view(central);
    expect(centralView.getUint16(30, true)).toBe(0);
    centralView.setUint16(30, 12, true);
    centralView.setUint32(42, 0xff_ff_ff_ff, true);
    centralView.setUint16(eocd.cdSize, 1, true);
    centralView.setUint16(eocd.cdSize + 2, 8, true);
    const localOffset = 2 ** 32 + 4096;
    centralView.setBigUint64(eocd.cdSize + 4, BigInt(localOffset), true);
    const centralOffset = localOffset + local.length;
    const zip64Offset = centralOffset + central.length;
    const tail = new Uint8Array(56 + 20 + 22),
      tailView = view(tail);
    tailView.setUint32(0, 0x06_06_4b_50, true);
    tailView.setBigUint64(4, 44n, true);
    tailView.setBigUint64(24, 1n, true);
    tailView.setBigUint64(32, 1n, true);
    tailView.setBigUint64(40, BigInt(central.length), true);
    tailView.setBigUint64(48, BigInt(centralOffset), true);
    tailView.setUint32(56, 0x07_06_4b_50, true);
    tailView.setBigUint64(64, BigInt(zip64Offset), true);
    tailView.setUint32(72, 1, true);
    tailView.setUint32(76, 0x06_05_4b_50, true);
    tailView.setUint16(84, 0xff_ff, true);
    tailView.setUint16(86, 0xff_ff, true);
    tailView.setUint32(88, 0xff_ff_ff_ff, true);
    tailView.setUint32(92, 0xff_ff_ff_ff, true);
    const size = zip64Offset + tail.length;
    let bytesRead = 0;
    const bucket = {
      head: () => ({ size, httpEtag: '"zip64"' }),
      get: (
        _key: string,
        options: { range: { offset: number; length: number } }
      ) => {
        const { offset, length } = options.range;
        bytesRead += length;
        const bytes = new Uint8Array(length);
        for (const [start, data] of [
          [localOffset, local],
          [centralOffset, central],
          [zip64Offset, tail],
        ] as const) {
          const from = Math.max(offset, start),
            to = Math.min(offset + length, start + data.length);
          if (to > from) {
            bytes.set(data.subarray(from - start, to - start), from - offset);
          }
        }
        return {
          size,
          httpEtag: '"zip64"',
          arrayBuffer: async () => bytes.buffer,
          body: new Response(bytes).body,
        };
      },
    } as unknown as R2Bucket;
    const directory = await readZipDirectory(bucket, key);
    expect(directory.entries[0].localHeaderOffset).toBe(localOffset);
    expect(
      new TextDecoder().decode(
        await readZipEntry(bucket, key, directory, directory.entries[0], 1024)
      )
    ).toBe('{"version":1,"cards":[]}');
    expect(bytesRead).toBeLessThan(70_000);
  });
  test("rejects encrypted, duplicate, truncated, and multidisk directories", async () => {
    const source = zipSync(
      { "files/a": strToU8("one"), "files/b": strToU8("two") },
      { level: 0 }
    );
    const eocd = findEocd(source)!;
    const encrypted = source.slice();
    view(encrypted).setUint16(eocd.cdOffset + 8, 1, true);
    await expect(readZipDirectory(bucketFor(encrypted), key)).rejects.toThrow(
      "invalid_archive_entry"
    );
    const duplicate = source.slice();
    const second = eocd.cdOffset + 46 + "files/a".length;
    duplicate.set(strToU8("files/a"), second + 46);
    await expect(readZipDirectory(bucketFor(duplicate), key)).rejects.toThrow(
      "invalid_archive_entry"
    );
    const truncated = source.slice();
    view(truncated).setUint32(eocd.offset + 12, eocd.cdSize - 1, true);
    await expect(readZipDirectory(bucketFor(truncated), key)).rejects.toThrow(
      "archive_parse_failed"
    );
    const multidisk = source.slice();
    view(multidisk).setUint16(eocd.offset + 4, 1, true);
    await expect(readZipDirectory(bucketFor(multidisk), key)).rejects.toThrow(
      "archive_parse_failed"
    );
  });
  test("rejects source replacement between directory and entry reads", async () => {
    const bytes = zipSync({ "files/a": strToU8("hello") });
    const bucket = new FakeBucket();
    bucket.objects.set(key, { bytes });
    const directory = await readZipDirectory(
      bucket as unknown as R2Bucket,
      key
    );
    const changed = bytes.slice();
    changed[32] = (changed[32] + 1) % 256;
    bucket.objects.set(key, { bytes: changed });
    await expect(
      readZipEntry(
        bucket as unknown as R2Bucket,
        key,
        directory,
        directory.entries[0],
        1024
      )
    ).rejects.toThrow("source_changed");
  });
});
