import {
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
} from "docx";
import type { PageLayoutBlock } from "./ocr/layout";

const run = (text: string, italics = false) =>
  new TextRun({
    text,
    italics,
    size: 22,
    font: { eastAsia: "PMingLiU", ascii: "Calibri", hAnsi: "Calibri" },
    color: italics ? "6B645C" : "1C1915",
  });

const line = { style: BorderStyle.SINGLE, size: 4, color: "1C1915" };
const borders = { top: line, bottom: line, left: line, right: line };

export type DocPage = { text: string; layout?: PageLayoutBlock[] };

/** One Word section per PDF, with tables, rules, and pictures kept in reading order. */
export async function pagesToDocx(title: string, pages: DocPage[]): Promise<Blob> {
  const children: FileChild[] = [];
  pages.forEach((page, index) => {
    if (index > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    const blocks = page.layout ?? [];
    if (!blocks.length) {
      children.push(...paragraphsFromText(page.text));
      return;
    }
    for (const block of blocks) children.push(...blockToDocx(block));
  });
  if (!children.length) children.push(new Paragraph({ children: [run("（此頁沒有文字）", true)] }));

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

function paragraphsFromText(text: string): Paragraph[] {
  const lines = text.split(/\n/);
  if (lines.every((line) => !line.trim())) return [new Paragraph({ children: [run("（此頁沒有文字）", true)] })];
  return lines.map(
    (lineText) =>
      new Paragraph({
        spacing: { after: 80, line: 288 },
        children: [run(lineText.length ? lineText : " ")],
      }),
  );
}

function blockToDocx(block: PageLayoutBlock): FileChild[] {
  if (block.kind === "rule") {
    return [
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "1C1915", space: 1 } },
        spacing: { before: 80, after: 80 },
        children: [run(" ")],
      }),
    ];
  }
  if (block.kind === "text") {
    return [
      new Paragraph({
        spacing: { after: block.role === "title" ? 160 : 80, line: 288 },
        children: [
          new TextRun({
            text: block.text,
            bold: block.role === "title",
            size: block.role === "title" ? 32 : 22,
            font: { eastAsia: "PMingLiU", ascii: "Calibri", hAnsi: "Calibri" },
            color: "1C1915",
          }),
        ],
      }),
    ];
  }
  if (block.kind === "table") {
    const cols = Math.max(1, ...block.rows.map((row) => row.length));
    return [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: block.rows.map(
          (row) =>
            new TableRow({
              children: Array.from({ length: cols }, (_, i) => {
                const value = row[i] ?? "";
                return new TableCell({
                  borders,
                  width: { size: 100 / cols, type: WidthType.PERCENTAGE },
                  children: [new Paragraph({ children: [run(value || " ")] })],
                });
              }),
            }),
        ),
      }),
      new Paragraph({ spacing: { after: 120 }, children: [run("")] }),
    ];
  }
  const png = dataUrlBytes(block.src);
  const width = Math.round(180 + block.width * 280);
  const height = block.role === "equation" ? 48 : Math.round(width * 0.55);
  const out: FileChild[] = [];
  if (png.length) {
    out.push(
      new Paragraph({
        spacing: { before: 80, after: 40 },
        children: [
          new ImageRun({
            type: "png",
            data: png,
            transformation: { width, height },
            altText: { title: block.role === "equation" ? "算式" : "圖表", description: block.text || (block.role === "equation" ? "算式" : "圖表"), name: block.role },
          }),
        ],
      }),
    );
  }
  if (block.text) {
    out.push(new Paragraph({ spacing: { after: 120 }, children: [run(block.text, true)] }));
  } else if (block.role === "graph") {
    out.push(new Paragraph({ spacing: { after: 120 }, children: [run("圖表", true)] }));
  }
  return out;
}

function dataUrlBytes(src: string): Uint8Array {
  const comma = src.indexOf(",");
  if (comma < 0) return new Uint8Array();
  const binary = atob(src.slice(comma + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function pagesToTxt(pages: string[]): string {
  return pages
    .map((text, i) => `—— 第 ${i + 1} 頁 ——\n${text.trim() || "（此頁沒有文字）"}`)
    .join("\n\n");
}
