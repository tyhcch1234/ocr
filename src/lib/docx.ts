import { Document, Packer, PageBreak, Paragraph, TextRun } from "docx";

const run = (text: string, italics = false) =>
  new TextRun({
    text,
    italics,
    size: 22,
    font: { eastAsia: "PMingLiU", ascii: "Calibri", hAnsi: "Calibri" },
    color: italics ? "6B645C" : "1C1915",
  });

/** One Word section per PDF, with a page break between PDF pages. */
export async function pagesToDocx(title: string, pages: string[]): Promise<Blob> {
  const children: Paragraph[] = [];
  pages.forEach((text, index) => {
    if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    const lines = text.split(/\n/);
    const empty = lines.every((line) => !line.trim());
    if (empty) {
      children.push(new Paragraph({ children: [run("（此頁沒有文字）", true)] }));
      return;
    }
    for (const line of lines) {
      children.push(
        new Paragraph({
          spacing: { after: 80, line: 288 },
          children: [run(line.length ? line : " ")],
        }),
      );
    }
  });

  const doc = new Document({
    title,
    sections: [
      {
        properties: {
          page: { margin: { top: 720, bottom: 720, left: 840, right: 840 } },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}

export function pagesToTxt(pages: string[]): string {
  return pages
    .map((text, i) => `—— 第 ${i + 1} 頁 ——\n${text.trim() || "（此頁沒有文字）"}`)
    .join("\n\n");
}
