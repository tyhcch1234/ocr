/** Turn Tesseract word boxes into readable lines, with CJK spacing cleaned up. */

const CJK =
  /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/;

export type OcrWord = {
  text: string;
  conf: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type OcrLine = {
  text: string;
  conf: number;
  bbox: [number, number, number, number];
  words: OcrWord[];
};

export function isMostlyCjk(text: string): boolean {
  const chars = [...text].filter((c) => !/\s/.test(c));
  if (!chars.length) return false;
  let n = 0;
  for (const c of chars) if (CJK.test(c)) n++;
  return n / chars.length >= 0.4;
}

/** Remove the spaces Tesseract inserts between Chinese characters. */
export function normalizeLine(text: string): string {
  let s = text.replace(/[ \t]+/g, " ").trim();
  s = s.replace(
    /([\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]) +(?=[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF])/g,
    "$1",
  );
  s = s.replace(/ +([，。、；：？！,.:;])/g, "$1");
  s = s.replace(/([，。、；：？！]) +/g, "$1");
  s = s.replace(/(\d) +(?=\d)/g, "$1");
  s = s.replace(/([（「『(]) +/g, "$1");
  s = s.replace(/ +([）」』)])/g, "$1");
  s = s.replace(/ {2,}/g, " ");
  return s;
}

export function usefulWords(words: OcrWord[]): OcrWord[] {
  return words.filter((w) => {
    const t = w.text.replace(/\s/g, "");
    if (!t) return false;
    if (!(w.conf >= 0)) return false;
    const cjk = CJK.test(t);
    if (/^[\s\W_]+$/.test(t) && w.conf < 78) return false;
    if (w.conf < 28) return false;
    if (!cjk && t.length === 1 && w.conf < 52) return false;
    if (!cjk && w.conf < 38 && t.length <= 2) return false;
    return true;
  });
}

export function groupLines(words: OcrWord[]): OcrLine[] {
  if (!words.length) return [];
  const items = words.map((w) => ({
    ...w,
    text: w.text.trim(),
    h: Math.max(1, w.y1 - w.y0),
  }));
  items.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);

  type Line = { items: typeof items; y0: number; y1: number };
  const lines: Line[] = [];
  for (const it of items) {
    let best: Line | null = null;
    let bestOverlap = 0;
    const start = Math.max(0, lines.length - 5);
    for (let i = lines.length - 1; i >= start; i--) {
      const line = lines[i];
      const overlap = Math.min(line.y1, it.y1) - Math.max(line.y0, it.y0);
      const minH = Math.min(Math.max(1, line.y1 - line.y0), it.h);
      if (overlap > minH * 0.45 && overlap > bestOverlap) {
        best = line;
        bestOverlap = overlap;
      }
    }
    if (!best) lines.push({ items: [it], y0: it.y0, y1: it.y1 });
    else {
      best.items.push(it);
      best.y0 = Math.min(best.y0, it.y0);
      best.y1 = Math.max(best.y1, it.y1);
    }
  }

  const built = lines.map((line) => {
    const sorted = line.items.slice().sort((a, b) => a.x0 - b.x0);
    let text = "";
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i];
      if (i === 0) {
        text = cur.text;
        continue;
      }
      const prev = sorted[i - 1];
      const gap = cur.x0 - prev.x1;
      const h = Math.max(prev.h, cur.h);
      const prevCjk = isMostlyCjk(prev.text);
      const curCjk = isMostlyCjk(cur.text);
      if (prevCjk !== curCjk) {
        if (!text.endsWith(" ") && !text.endsWith("-")) text += " ";
        text += cur.text;
        continue;
      }
      if (prevCjk && curCjk) {
        if (gap > h * 0.85) text += "  ";
        text += cur.text;
      } else if (text.endsWith("-") && gap < h * 0.35) {
        text += cur.text;
      } else if (gap > h * 0.16) {
        if (!text.endsWith(" ")) text += " ";
        text += cur.text;
      } else if (!prevCjk && !curCjk && gap > h * 0.06) {
        if (!text.endsWith(" ")) text += " ";
        text += cur.text;
      } else {
        text += cur.text;
      }
    }
    const conf = sorted.reduce((s, w) => s + w.conf, 0) / sorted.length;
    const bbox: [number, number, number, number] = [
      Math.min(...sorted.map((w) => w.x0)),
      Math.min(...sorted.map((w) => w.y0)),
      Math.max(...sorted.map((w) => w.x1)),
      Math.max(...sorted.map((w) => w.y1)),
    ];
    return {
      text: normalizeLine(text),
      conf,
      bbox,
      words: sorted.map((word) => ({
        text: word.text,
        conf: word.conf,
        x0: word.x0,
        y0: word.y0,
        x1: word.x1,
        y1: word.y1,
      })),
    };
  });

  return readingOrder(built.filter((l) => l.text.trim()));
}

export function readingOrder<T extends { bbox: [number, number, number, number] }>(
  items: T[],
  depth = 0,
): T[] {
  if (items.length <= 1 || depth > 10) {
    return items.slice().sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  }
  const gutter = findGutter(items);
  if (gutter) {
    const mid = (gutter[0] + gutter[1]) / 2;
    const left: T[] = [];
    const right: T[] = [];
    const spanning: T[] = [];
    for (const it of items) {
      if (it.bbox[0] < gutter[0] - 1 && it.bbox[2] > gutter[1] + 1) spanning.push(it);
      else if ((it.bbox[0] + it.bbox[2]) / 2 <= mid) left.push(it);
      else right.push(it);
    }
    if (left.length >= 2 && right.length >= 2) {
      return [
        ...readingOrder(left, depth + 1),
        ...readingOrder(spanning, depth + 1),
        ...readingOrder(right, depth + 1),
      ];
    }
  }
  return items.slice().sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
}

function findGutter<T extends { bbox: [number, number, number, number] }>(
  items: T[],
): [number, number] | null {
  const x0 = Math.min(...items.map((i) => i.bbox[0]));
  const x1 = Math.max(...items.map((i) => i.bbox[2]));
  const width = x1 - x0;
  if (width < 80) return null;
  const bin = 4;
  const n = Math.ceil(width / bin) + 1;
  const cover = new Float64Array(n);
  let top = Infinity;
  let bottom = -Infinity;
  for (const it of items) {
    top = Math.min(top, it.bbox[1]);
    bottom = Math.max(bottom, it.bbox[3]);
    const lo = Math.max(0, Math.floor((it.bbox[0] - x0) / bin));
    const hi = Math.min(n - 1, Math.ceil((it.bbox[2] - x0) / bin));
    const h = Math.max(1, it.bbox[3] - it.bbox[1]);
    for (let b = lo; b <= hi; b++) cover[b] += h;
  }
  const th = 0.12 * Math.max(1, bottom - top);
  let best: [number, number] | null = null;
  let start = -1;
  for (let b = 0; b <= n; b++) {
    const empty = b < n ? cover[b] < th : false;
    if (empty && start < 0) start = b;
    if (!empty && start >= 0) {
      if (b - start >= 4) {
        const gx0 = x0 + start * bin;
        const gx1 = x0 + b * bin;
        const left = items.filter((i) => i.bbox[2] <= gx0 + 2).length;
        const right = items.filter((i) => i.bbox[0] >= gx1 - 2).length;
        if (left >= 2 && right >= 2 && (!best || gx1 - gx0 > best[1] - best[0])) {
          best = [gx0, gx1];
        }
      }
      start = -1;
    }
  }
  return best;
}

export function linesToText(lines: OcrLine[]): string {
  return lines
    .map((l) => l.text)
    .filter(Boolean)
    .join("\n");
}

export function meanConfidence(lines: OcrLine[]): number {
  if (!lines.length) return 0;
  const weights = lines.map((l) => Math.max(1, l.text.replace(/\s/g, "").length));
  const total = weights.reduce((a, b) => a + b, 0);
  return lines.reduce((s, l, i) => s + l.conf * weights[i], 0) / total;
}
