import { readingOrder, type OcrLine, type OcrWord } from "./reconstruct";

export type PdfGlyph = {
  str: string;
  x: number;
  y: number;
  w: number;
  size: number;
};

/** Glyphs on one baseline become a line of words. `scale` matches a rendered page. */
export function glyphsToLines(glyphs: PdfGlyph[], scale = 1): OcrLine[] {
  const items = glyphs.filter((g) => g.str.trim());
  if (!items.length) return [];
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: PdfGlyph[][] = [];
  for (const it of items) {
    const line = groups.find((g) => {
      const ref = g[0];
      return Math.abs(ref.y - it.y) <= Math.max(2, Math.min(ref.size, it.size) * 0.45);
    });
    if (line) line.push(it);
    else groups.push([it]);
  }
  const lines: OcrLine[] = [];
  for (const group of groups) {
    group.sort((a, b) => a.x - b.x);
    const words: OcrWord[] = [];
    let text = "";
    let prevEnd: number | null = null;
    for (const it of group) {
      let piece = it.str;
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        if (gap > it.size * 0.28 && !/\s$/.test(text) && !/^\s/.test(piece)) piece = ` ${piece}`;
      }
      text += piece;
      const x0 = it.x * scale;
      const y1 = it.y * scale + it.size * scale * 0.25;
      const y0 = y1 - it.size * scale * 1.1;
      words.push({
        text: it.str.trim(),
        conf: 100,
        x0,
        y0,
        x1: (it.x + it.w) * scale,
        y1,
      });
      prevEnd = it.x + it.w;
    }
    const kept = words.filter((w) => w.text);
    if (!kept.length) continue;
    lines.push({
      text: text.replace(/[ \t]+/g, " ").trim(),
      conf: 100,
      bbox: [
        Math.min(...kept.map((w) => w.x0)),
        Math.min(...kept.map((w) => w.y0)),
        Math.max(...kept.map((w) => w.x1)),
        Math.max(...kept.map((w) => w.y1)),
      ],
      words: kept,
    });
  }
  return readingOrder(lines.filter((l) => l.text));
}

/** Join a PDF text layer into reading order. Coordinates are viewport pixels, y downward. */
export function assemblePdfText(glyphs: PdfGlyph[]): { text: string; chars: number } {
  const items = glyphs.filter((g) => g.str.trim());
  if (!items.length) return { text: "", chars: 0 };

  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: PdfGlyph[][] = [];
  for (const it of items) {
    const line = groups.find((g) => {
      const ref = g[0];
      return Math.abs(ref.y - it.y) <= Math.max(2, Math.min(ref.size, it.size) * 0.45);
    });
    if (line) line.push(it);
    else groups.push([it]);
  }

  const blocks = groups.map((line) => {
    line.sort((a, b) => a.x - b.x);
    let text = "";
    let prevEnd: number | null = null;
    for (const it of line) {
      let piece = it.str;
      if (prevEnd !== null) {
        const gap = it.x - prevEnd;
        if (gap > it.size * 0.28 && !/\s$/.test(text) && !/^\s/.test(piece)) piece = " " + piece;
      }
      text += piece;
      prevEnd = it.x + it.w;
    }
    const x0 = line[0].x;
    const x1 = Math.max(...line.map((it) => it.x + it.w));
    const y = line.reduce((s, it) => s + it.y, 0) / line.length;
    const size = Math.max(...line.map((it) => it.size));
    return {
      text: text.replace(/[ \t]+/g, " ").trim(),
      bbox: [x0, y - size * 0.85, x1, y + size * 0.25] as [number, number, number, number],
    };
  });

  const ordered = readingOrder(blocks.filter((b) => b.text));
  const text = ordered.map((b) => b.text).join("\n");
  const chars = text.replace(/\s/g, "").length;
  return { text, chars };
}
