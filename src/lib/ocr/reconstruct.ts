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

function keepMathToken(text: string): boolean {
  const compact = text.replace(/\s/g, "");
  if (compact.length < 3) return false;
  return /[A-Za-z]/.test(compact) && (/\d/.test(compact) || /[+\-−×÷=^]/.test(compact));
}

export function usefulWords(words: OcrWord[]): OcrWord[] {
  const kept = words.filter((w) => {
    const t = w.text.replace(/\s/g, "");
    if (!t) return false;
    if (!(w.conf >= 0)) return false;
    if (keepMathToken(t)) return true;
    const cjk = CJK.test(t);
    if (/^[\s\W_]+$/.test(t) && w.conf < 78) return false;
    if (w.conf < 28) return false;
    if (!cjk && t.length === 1 && w.conf < 52) return false;
    if (!cjk && w.conf < 38 && t.length <= 2) return false;
    return true;
  });
  const math = kept.filter((w) => keepMathToken(w.text));
  for (const w of words) {
    if (kept.includes(w)) continue;
    const t = w.text.trim();
    if (!t || t.length > 6) continue;
    const label = math.some((item) => {
      const dy = Math.abs((item.y0 + item.y1) / 2 - (w.y0 + w.y1) / 2);
      return dy < 24 && w.x1 <= item.x0 + 8 && item.x0 - w.x1 < 90;
    });
    if (label) kept.push(w);
  }
  return kept;
}

function verticalMarginWord(word: OcrWord, pageW: number): boolean {
  const width = word.x1 - word.x0;
  const height = word.y1 - word.y0;
  const cx = (word.x0 + word.x1) / 2;
  const onEdge = cx < pageW * 0.115 || cx > pageW * 0.885;
  if (!onEdge || width > 56 || width < 6) return false;
  const tall = height >= 24 && height > width * 1.05;
  return tall || width < 42;
}

function orientMargin(words: OcrWord[]): string {
  const sorted = words.slice().sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  const down = sorted.map((w) => w.text.trim());
  const up = down.slice().reverse();
  const score = (row: string[]) => {
    const first = row[0] ?? "";
    const last = row[row.length - 1] ?? "";
    let value = 0;
    if (/^[A-Z]/.test(first)) value += 2;
    if (/[.?!。]$/.test(last)) value += 2;
    if (/[.?!。]$/.test(first)) value -= 2;
    if (/^[A-Z]/.test(last) && !/[.?!。]$/.test(last)) value -= 1;
    return value;
  };
  return normalizeLine((score(up) > score(down) ? up : down).join(" "));
}

function peelMarginNotes(words: OcrWord[], pageW: number): { body: OcrWord[]; notes: string[] } {
  const left: OcrWord[] = [];
  const right: OcrWord[] = [];
  const body: OcrWord[] = [];
  for (const word of words) {
    if (!verticalMarginWord(word, pageW)) {
      body.push(word);
      continue;
    }
    const cx = (word.x0 + word.x1) / 2;
    (cx < pageW / 2 ? left : right).push(word);
  }
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const side of [left, right]) {
    if (side.length < 4) {
      body.push(...side);
      continue;
    }
    const text = orientMargin(side);
    const key = text.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    notes.push(text);
  }
  return { body, notes };
}

export function groupLines(words: OcrWord[], pageW?: number): OcrLine[] {
  if (!words.length) return [];
  const width = pageW && pageW > 0 ? pageW : Math.max(...words.map((w) => w.x1));
  const peeled = peelMarginNotes(words, width);
  const items = peeled.body.map((w) => ({
    ...w,
    text: w.text.trim(),
    h: Math.max(1, w.y1 - w.y0),
  }));
  items.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2 || a.x0 - b.x0);

  type Bucket = { items: typeof items; y0: number; y1: number };
  const buckets: Bucket[] = [];
  for (const it of items) {
    let best: Bucket | null = null;
    let bestOverlap = 0;
    const start = Math.max(0, buckets.length - 5);
    for (let i = buckets.length - 1; i >= start; i--) {
      const line = buckets[i];
      const overlap = Math.min(line.y1, it.y1) - Math.max(line.y0, it.y0);
      const minH = Math.min(Math.max(1, line.y1 - line.y0), it.h);
      const tall = it.h > Math.max(it.x1 - it.x0, 1) * 1.2 && it.h > minH * 1.7;
      if (!tall && overlap > minH * 0.45 && overlap > bestOverlap) {
        best = line;
        bestOverlap = overlap;
      }
    }
    if (!best) buckets.push({ items: [it], y0: it.y0, y1: it.y1 });
    else {
      best.items.push(it);
      best.y0 = Math.min(best.y0, it.y0);
      best.y1 = Math.max(best.y1, it.y1);
    }
  }

  const built = buckets.flatMap((line) => {
    const sorted = line.items.slice().sort((a, b) => a.x0 - b.x0);
    const segments: (typeof sorted)[] = [];
    for (const word of sorted) {
      const prev = segments[segments.length - 1]?.at(-1);
      const gap = prev ? word.x0 - prev.x1 : 0;
      const h = Math.max(word.h, prev?.h ?? 0, 8);
      const split = prev && !isMostlyCjk(prev.text) && !isMostlyCjk(word.text) && gap > Math.max(h * 2.4, width * 0.04);
      if (!segments.length || split) segments.push([word]);
      else segments[segments.length - 1].push(word);
    }
    const lineY0 = Math.min(...sorted.map((w) => w.y0));
    const lineY1 = Math.max(...sorted.map((w) => w.y1));
    return segments.map((wordsInLine) => {
    let text = "";
    for (let i = 0; i < wordsInLine.length; i++) {
      const cur = wordsInLine[i];
      if (i === 0) {
        text = cur.text;
        continue;
      }
      const prev = wordsInLine[i - 1];
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
      } else {
        if (!text.endsWith(" ")) text += " ";
        text += cur.text;
      }
    }
    const conf = wordsInLine.reduce((s, w) => s + w.conf, 0) / wordsInLine.length;
    const bbox: [number, number, number, number] = [
      Math.min(...wordsInLine.map((w) => w.x0)),
      lineY0,
      Math.max(...wordsInLine.map((w) => w.x1)),
      lineY1,
    ];
    return {
      text: normalizeLine(text),
      conf,
      bbox,
      words: wordsInLine.map((word) => ({
        text: word.text,
        conf: word.conf,
        x0: word.x0,
        y0: word.y0,
        x1: word.x1,
        y1: word.y1,
      })),
    };
    });
  });

  const lines = readingOrder(built.filter((l) => l.text.trim()));
  const blob = lines.map((line) => line.text.toLowerCase()).join("\n");
  let y = Math.max(0, ...lines.map((line) => line.bbox[3])) + 24;
  for (const note of peeled.notes) {
    const key = note.toLowerCase().slice(0, 24);
    if (key && blob.includes(key)) continue;
    lines.push({
      text: note,
      conf: 90,
      bbox: [8, y, Math.max(40, width * 0.7), y + 20],
      words: [],
    });
    y += 28;
  }
  return lines;
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
