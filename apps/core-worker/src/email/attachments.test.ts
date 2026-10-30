import { describe, expect, test } from "bun:test";
import PostalMime, { type Attachment } from "postal-mime";
import { fixture } from "../test/emailSupport";
import {
  DECORATION_MAX_BYTES,
  MAX_ATTACHMENTS,
  selectAttachments,
} from "./attachments";

const part = (fields: Partial<Attachment>): Attachment => ({
  content: new Uint8Array([1, 2, 3]).buffer,
  disposition: "attachment",
  filename: "file.bin",
  mimeType: "application/octet-stream",
  ...fields,
});

describe("selectAttachments", () => {
  test("keeps files and the inline photo; drops the logo, signature, winmail.dat and invite", async () => {
    const email = await PostalMime.parse(fixture("attachments.eml"));
    const selected = selectAttachments(email);
    expect(
      selected.map(({ fileName, index, mimeType, size }) => ({
        fileName,
        index,
        mimeType,
        size,
      }))
    ).toEqual([
      {
        fileName: "IMG_0420.jpeg",
        index: 0,
        mimeType: "image/jpeg",
        size: 40 * 1024,
      },
      {
        fileName: "itinerary.pdf",
        index: 1,
        mimeType: "application/pdf",
        size: 3016,
      },
      {
        fileName: "attachment-3.pdf",
        index: 2,
        mimeType: "application/pdf",
        size: 3016,
      },
    ]);
    expect(selected[0]?.content.byteLength).toBe(40 * 1024);
  });

  test("an inline image the HTML doesn't show is a file, however small", () => {
    const selected = selectAttachments({
      attachments: [
        part({
          contentId: "<unused@local>",
          disposition: "inline",
          filename: "tiny.png",
          mimeType: "image/png",
        }),
      ],
      html: "<p>No images here</p>",
    });
    expect(selected.map((file) => file.fileName)).toEqual(["tiny.png"]);
  });

  test("a referenced inline image at the decoration limit is kept", () => {
    const selected = selectAttachments({
      attachments: [
        part({
          content: new Uint8Array(DECORATION_MAX_BYTES).buffer,
          contentId: "<banner@local>",
          filename: "banner.png",
          mimeType: "image/png",
        }),
      ],
      html: '<img src="cid:banner@local">',
    });
    expect(selected).toHaveLength(1);
  });

  test.each([
    ["application/pkcs7-signature", "signature.p7s"],
    ["application/x-pkcs7-signature", "sig.p7s"],
    ["application/ms-tnef", "anything.dat"],
    ["text/calendar", "invite.ics"],
    ["application/octet-stream", "SMIME.P7S"],
    ["application/octet-stream", "WINMAIL.DAT"],
  ])("%s %s is skipped", (mimeType, filename) => {
    expect(
      selectAttachments({ attachments: [part({ filename, mimeType })] })
    ).toEqual([]);
  });

  test("a part with no name keeps a known type and gets a name; an unknown one is skipped", () => {
    const selected = selectAttachments({
      attachments: [
        part({ filename: null, mimeType: "image/heic" }),
        part({ filename: null, mimeType: "application/x-unknown" }),
        part({ filename: "  ", mimeType: "audio/mpeg" }),
      ],
    });
    expect(selected.map((file) => file.fileName)).toEqual([
      "attachment-1.heic",
      "attachment-2.mp3",
    ]);
  });

  test("an empty part is skipped", () => {
    expect(
      selectAttachments({
        attachments: [
          part({ content: new ArrayBuffer(0), filename: "empty.txt" }),
        ],
      })
    ).toEqual([]);
  });

  test("string content in base64 or UTF-8 is read as bytes", () => {
    const [base64, utf8] = selectAttachments({
      attachments: [
        part({ content: btoa("hello"), encoding: "base64", filename: "a.txt" }),
        part({ content: "héllo", encoding: "utf8", filename: "b.txt" }),
      ],
    });
    expect(new TextDecoder().decode(base64?.content)).toBe("hello");
    expect(utf8?.size).toBe(6);
  });

  test(`at most ${MAX_ATTACHMENTS} are kept, indexed in order`, () => {
    const selected = selectAttachments({
      attachments: Array.from({ length: 55 }, (_, n) =>
        part({ filename: `note-${n}.txt`, mimeType: "text/plain" })
      ),
    });
    expect(selected).toHaveLength(MAX_ATTACHMENTS);
    expect(selected.at(-1)).toMatchObject({
      fileName: "note-49.txt",
      index: 49,
    });
  });
});
