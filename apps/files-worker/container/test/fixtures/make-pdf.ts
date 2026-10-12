// Writes a minimal PDF with one line of text per page: "Marker-001." on
// page 1 through "Marker-NNN." on the last page. With --no-text, each page
// only paints a filled shape, like a scan without a text layer.
//   bun make-pdf.ts <pages> <output.pdf> [--no-text]

import { writeFileSync } from "node:fs";

const [pagesArg, output, mode] = process.argv.slice(2);
const noText = mode === "--no-text";
const pageCount = Number(pagesArg);
if (!(Number.isInteger(pageCount) && pageCount > 0 && output)) {
  throw new Error("usage: bun make-pdf.ts <pages> <output.pdf> [--no-text]");
}

// Objects: 1 catalog, 2 pages, 3 font, then a page and a content stream
// for each page.
const objects: string[] = [];
const pageIds = Array.from({ length: pageCount }, (_, index) => 4 + index * 2);
objects.push("<< /Type /Catalog /Pages 2 0 R >>");
objects.push(
  `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`
);
objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
for (const [index, id] of pageIds.entries()) {
  const label = `Marker-${String(index + 1).padStart(3, "0")}.`;
  const stream = noText
    ? "0.2 0.4 0.8 rg 72 72 468 648 re f"
    : `BT /F1 24 Tf 72 720 Td (${label}) Tj ET`;
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`
  );
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
}

let body = "%PDF-1.4\n";
const offsets: number[] = [];
for (const [index, object] of objects.entries()) {
  offsets.push(body.length);
  body += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = body.length;
body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets) {
  body += `${String(offset).padStart(10, "0")} 00000 n \n`;
}
body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

writeFileSync(output, body);
