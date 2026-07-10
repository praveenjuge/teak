import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentPreview } from "../DocumentPreview";

const createDocumentCard = (overrides?: Record<string, unknown>) => ({
  _id: "card_doc_1",
  _creationTime: Date.now(),
  content: "Document card",
  createdAt: Date.now(),
  isDeleted: false,
  isFavorited: false,
  type: "document",
  updatedAt: Date.now(),
  userId: "user_123",
  fileUrl:
    "https://teak-files-prod.example.r2.cloudflarestorage.com/user/doc.pdf?sig=abc",
  fileMetadata: {
    fileName: "invoice.pdf",
    mimeType: "application/pdf",
  },
  ...overrides,
});

describe("DocumentPreview", () => {
  test("renders a PDF in an iframe without a sandbox attribute", () => {
    // A sandboxed iframe (especially with allow-same-origin) breaks the
    // browser PDF viewer and triggers a cross-origin "Blocked a frame" error
    // for our signed R2 URLs. The iframe must render un-sandboxed.
    const markup = renderToStaticMarkup(
      <DocumentPreview card={createDocumentCard() as never} />
    );

    expect(markup).toContain("<iframe");
    expect(markup).toContain("doc.pdf");
    expect(markup).not.toContain("sandbox");
    expect(markup).not.toContain("allow-same-origin");
  });

  test("detects PDFs by extension even when the mime type is missing", () => {
    const markup = renderToStaticMarkup(
      <DocumentPreview
        card={
          createDocumentCard({
            fileMetadata: { fileName: "report.pdf", mimeType: "" },
          }) as never
        }
      />
    );

    expect(markup).toContain("<iframe");
    expect(markup).not.toContain("sandbox");
  });

  test("falls back to an icon and file name for non-PDF documents", () => {
    const markup = renderToStaticMarkup(
      <DocumentPreview
        card={
          createDocumentCard({
            fileMetadata: {
              fileName: "notes.docx",
              mimeType:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
          }) as never
        }
      />
    );

    expect(markup).not.toContain("<iframe");
    expect(markup).toContain("notes.docx");
  });

  test("shows ZIP manifest facts without archive contents", () => {
    const markup = renderToStaticMarkup(
      <DocumentPreview
        card={
          createDocumentCard({
            fileMetadata: {
              fileName: "package.zip",
              kind: "archive",
              mimeType: "application/zip",
              preview: {
                archiveDirectoryCount: 3,
                archiveFileCount: 12,
              },
            },
          }) as never
        }
      />
    );

    expect(markup).toContain("12 files");
    expect(markup).toContain("3 folders");
  });

  test("shows Office slide facts and a safe open action", () => {
    const markup = renderToStaticMarkup(
      <DocumentPreview
        card={
          createDocumentCard({
            fileMetadata: {
              fileName: "deck.pptx",
              kind: "office",
              mimeType:
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
              preview: { slideCount: 8 },
            },
          }) as never
        }
      />
    );

    expect(markup).toContain("8 slides");
    expect(markup).toContain("Open file");
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  test("does not render an iframe when the file URL is missing", () => {
    const markup = renderToStaticMarkup(
      <DocumentPreview
        card={createDocumentCard({ fileUrl: undefined }) as never}
      />
    );

    expect(markup).not.toContain("<iframe");
    expect(markup).toContain("invoice.pdf");
  });
});
