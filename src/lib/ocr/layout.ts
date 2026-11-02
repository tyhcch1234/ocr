/**
 * Rebuild a page as text, rules, tables, and pictures of charts or formulas.
 * Charts and equations stay cropped from the scan so their shape is unchanged.
 */

import { cropGray, downscale, encodeGrayPng, type Gray } from "./image";
import type { OcrLine } from "./reconstruct";

export type BBox = [number, number, number, number];

export type LayoutPiece =
  | { kind: "text"; role: "title" | "body"; text: string; bbox: BBox }
  | { kind: "rule"; bbox: BBox }
  | { kind: "table"; rows: string[][]; bbox: BBox }
  | { kind: "image"; role: "graph" | "equation"; text: string; bbox: BBox; png: Uint8Array };

export type PageLayoutBlock =
  | { kind: "text"; role: "title" | "body"; text: string }
  | { kind: "rule" }
  | { kind: "table"; rows: string[][] }
  | { kind: "image"; role: "graph" | "equation"; text: string; src: string; width: number };

type Seg = { x0: number; y0: number; x1: number; y1: number };

const MATH = /[=≈≠≤≥≡+\-−×÷∑∫√^±∞π]/;

export function looksLikeMath(text: string): boolean {
  const compact = text.replace(/\s/g, "");
  if (compact.length < 3 || !MATH.test(compact)) return false;
  const symbols = compact.match(/[=≈≠≤≥≡+\-−×÷∑∫√^±∞π\d]/g)?.length ?? 0;
  return symbols / compact.length >= 0.45 && /[=≈≠≤≥≡]/.test(compact);
}

function median(img: Gray): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < img.d.length; i += 3) hist[img.d[i]]++;
  const target = Math.max(1, Math.floor(img.d.length / 6));
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

function darkMask(img: Gray): Uint8Array {
  const paper = median(img);
  const limit = Math.min(150, paper - 28);
  const mask = new Uint8Array(img.d.length);
  for (let i = 0; i < img.d.length; i++) if (img.d[i] <= limit) mask[i] = 1;
  return mask;
}

function mapBox(box: BBox, from: Gray, toW: number, toH: number): BBox {
  const sx = toW / from.w;
  const sy = toH / from.h;
  return [box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy];
}

/** Thin, long strokes. A solid bar is one thick band and is left for the chart crop. */
export function detectRules(img: Gray): { horizontal: Seg[]; vertical: Seg[] } {
  const small = downscale(img, 720);
  const mask = darkMask(small);
  const maxThick = Math.max(4, Math.round(Math.min(small.w, small.h) * 0.012));
  const minH = Math.max(8, small.w * 0.18);
  const minV = Math.max(8, small.h * 0.04);
  const horizontal = thinBands(mask, small.w, small.h, "h", minH, maxThick);
  const vertical = thinBands(mask, small.w, small.h, "v", minV, maxThick);
  const sx = img.w / small.w;
  const sy = img.h / small.h;
  const scale = (seg: Seg): Seg => ({
    x0: seg.x0 * sx,
    x1: seg.x1 * sx,
    y0: seg.y0 * sy,
    y1: seg.y1 * sy,
  });
  return {
    horizontal: mergeCollinear(horizontal.map(scale), "h", Math.max(4, img.h * 0.008)),
    vertical: mergeCollinear(vertical.map(scale), "v", Math.max(4, img.w * 0.008)),
  };
}

function thinBands(mask: Uint8Array, w: number, h: number, axis: "h" | "v", minLen: number, maxThick: number): Seg[] {
  const lines = axis === "h" ? h : w;
  const span = axis === "h" ? w : h;
  const perLine: Seg[][] = Array.from({ length: lines }, () => []);
  for (let i = 0; i < lines; i++) {
    let start = -1;
    for (let j = 0; j <= span; j++) {
      const on = j < span && mask[axis === "h" ? i * w + j : j * w + i] === 1;
      if (on && start < 0) start = j;
      if (!on && start >= 0) {
        if (j - start >= minLen) {
          perLine[i].push(
            axis === "h" ? { x0: start, x1: j, y0: i, y1: i + 1 } : { x0: i, x1: i + 1, y0: start, y1: j },
          );
        }
        start = -1;
      }
    }
  }
  const out: Seg[] = [];
  const finish = (seg: Seg) => {
    const thickness = axis === "h" ? seg.y1 - seg.y0 : seg.x1 - seg.x0;
    const length = axis === "h" ? seg.x1 - seg.x0 : seg.y1 - seg.y0;
    if (thickness <= maxThick && length >= minLen) out.push(seg);
  };
  const aligned = (a: Seg, b: Seg) =>
    axis === "h" ? overlap(a.x0, a.x1, b.x0, b.x1) > 0.45 : overlap(a.y0, a.y1, b.y0, b.y1) > 0.45;
  let active: Seg[] = [];
  for (let i = 0; i <= lines; i++) {
    const row = i < lines ? perLine[i] : [];
    const next: Seg[] = [];
    const used = new Set<number>();
    for (const run of row) {
      const hits = active.map((seg, idx) => ({ seg, idx })).filter(({ seg }) => aligned(seg, run));
      const merged: Seg = { ...run };
      for (const hit of hits) {
        used.add(hit.idx);
        merged.x0 = Math.min(merged.x0, hit.seg.x0);
        merged.y0 = Math.min(merged.y0, hit.seg.y0);
        merged.x1 = Math.max(merged.x1, hit.seg.x1);
        merged.y1 = Math.max(merged.y1, hit.seg.y1);
      }
      next.push(merged);
    }
    active.forEach((seg, idx) => {
      if (!used.has(idx)) finish(seg);
    });
    active = next;
  }
  return out;
}

function mergeCollinear(segs: Seg[], axis: "h" | "v", tol: number): Seg[] {
  const sorted = segs.slice().sort((a, b) => (axis === "h" ? a.y0 - b.y0 || a.x0 - b.x0 : a.x0 - b.x0 || a.y0 - b.y0));
  const out: Seg[] = [];
  for (const seg of sorted) {
    const prev = out.find((item) =>
      axis === "h"
        ? Math.abs(mid(item.y0, item.y1) - mid(seg.y0, seg.y1)) <= tol && seg.x0 - item.x1 <= tol * 6 && item.x0 - seg.x1 <= tol * 6
        : Math.abs(mid(item.x0, item.x1) - mid(seg.x0, seg.x1)) <= tol && seg.y0 - item.y1 <= tol * 6 && item.y0 - seg.y1 <= tol * 6,
    );
    if (!prev) {
      out.push({ ...seg });
      continue;
    }
    prev.x0 = Math.min(prev.x0, seg.x0);
    prev.y0 = Math.min(prev.y0, seg.y0);
    prev.x1 = Math.max(prev.x1, seg.x1);
    prev.y1 = Math.max(prev.y1, seg.y1);
  }
  return out;
}

function mid(a: number, b: number): number {
  return (a + b) / 2;
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  const inter = Math.min(a1, b1) - Math.max(a0, b0);
  const base = Math.max(1, Math.min(a1 - a0, b1 - b0));
  return inter / base;
}

function center(box: BBox): [number, number] {
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}

function union(boxes: BBox[]): BBox {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

function intersects(a: BBox, b: BBox, pad = 0): boolean {
  return a[0] - pad < b[2] && a[2] + pad > b[0] && a[1] - pad < b[3] && a[3] + pad > b[1];
}

function inside(box: BBox, outer: BBox, pad = 2): boolean {
  const [x, y] = center(box);
  return x >= outer[0] - pad && x <= outer[2] + pad && y >= outer[1] - pad && y <= outer[3] + pad;
}

type Unit = { text: string; bbox: BBox; line: number };

function unitsOf(lines: OcrLine[]): Unit[] {
  const units: Unit[] = [];
  lines.forEach((line, lineNo) => {
    const words = line.words.filter((w) => w.text.trim());
    if (words.length >= 2) {
      for (const w of words) units.push({ text: w.text.trim(), bbox: [w.x0, w.y0, w.x1, w.y1], line: lineNo });
    } else if (line.text.trim()) {
      units.push({ text: line.text.trim(), bbox: line.bbox, line: lineNo });
    }
  });
  return units;
}

function crosses(h: Seg, v: Seg, pad: number): boolean {
  const hy = mid(h.y0, h.y1);
  const vx = mid(v.x0, v.x1);
  return vx >= h.x0 - pad && vx <= h.x1 + pad && hy >= v.y0 - pad && hy <= v.y1 + pad;
}

function tablesFromRules(lines: OcrLine[], rules: { horizontal: Seg[]; vertical: Seg[] }): { rows: string[][]; bbox: BBox; used: Set<number> }[] {
  const pad = 3;
  let hs = rules.horizontal.slice();
  let vs = rules.vertical.slice();
  for (let pass = 0; pass < 4; pass++) {
    const nextH = hs.filter((h) => vs.filter((v) => crosses(h, v, pad)).length >= 2);
    const nextV = vs.filter((v) => nextH.filter((h) => crosses(h, v, pad)).length >= 2);
    if (nextH.length === hs.length && nextV.length === vs.length) break;
    hs = nextH;
    vs = nextV;
  }
  if (hs.length < 2 || vs.length < 2) return [];

  const parent = hs.concat(vs).map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  hs.forEach((h, i) => {
    vs.forEach((v, j) => {
      if (crosses(h, v, pad)) join(i, hs.length + j);
    });
  });

  const groups = new Map<number, { h: Seg[]; v: Seg[] }>();
  hs.forEach((seg, i) => {
    const id = find(i);
    const group = groups.get(id) ?? { h: [], v: [] };
    group.h.push(seg);
    groups.set(id, group);
  });
  vs.forEach((seg, i) => {
    const id = find(hs.length + i);
    const group = groups.get(id) ?? { h: [], v: [] };
    group.v.push(seg);
    groups.set(id, group);
  });

  const tables: { rows: string[][]; bbox: BBox; used: Set<number> }[] = [];
  const claimed = new Set<number>();
  for (const group of groups.values()) {
    if (group.h.length < 2 || group.v.length < 2) continue;
    const built = gridFromLines(lines, group.h, group.v, claimed);
    if (built) tables.push(built);
  }
  return tables.sort((a, b) => a.bbox[1] - b.bbox[1]);
}

function gridFromLines(lines: OcrLine[], hs: Seg[], vs: Seg[], claimed: Set<number>): { rows: string[][]; bbox: BBox; used: Set<number> } | null {
  const tol = Math.max(4, (Math.max(...vs.map((s) => s.x1)) - Math.min(...vs.map((s) => s.x0))) * 0.02);
  const ys = dedupe(hs.map((s) => mid(s.y0, s.y1)), tol);
  const xs = dedupe(vs.map((s) => mid(s.x0, s.x1)), tol);
  if (ys.length < 2 || xs.length < 2) return null;
  const bbox: BBox = [xs[0], ys[0], xs[xs.length - 1], ys[ys.length - 1]];
  if (bbox[2] - bbox[0] < 40 || bbox[3] - bbox[1] < 16) return null;
  const units = unitsOf(lines).filter((u) => !claimed.has(u.line) && inside(u.bbox, bbox, 8));
  if (units.length < 2) return null;
  const rows: string[][] = Array.from({ length: ys.length - 1 }, () => Array(xs.length - 1).fill(""));
  const used = new Set<number>();
  for (const unit of units) {
    const [x, y] = center(unit.bbox);
    const col = xs.findIndex((edge, i) => i < xs.length - 1 && x >= edge - tol && x < xs[i + 1] + tol * 0.25);
    const row = ys.findIndex((edge, i) => i < ys.length - 1 && y >= edge - tol && y < ys[i + 1] + tol * 0.25);
    if (row < 0 || col < 0) continue;
    rows[row][col] = rows[row][col] ? `${rows[row][col]} ${unit.text}` : unit.text;
    used.add(unit.line);
  }
  const filled = rows.reduce((n, row) => n + row.filter(Boolean).length, 0);
  const cells = rows.length * rows[0].length;
  if (used.size < 2 || filled < 2 || (cells > 6 && filled / cells < 0.34)) return null;
  for (const index of used) claimed.add(index);
  return { rows, bbox, used };
}

function dedupe(values: number[], tol: number): number[] {
  const sorted = values.slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!out.length || v - out[out.length - 1] > tol) out.push(v);
  }
  return out;
}

function whitespaceTable(lines: OcrLine[], pageW: number): { rows: string[][]; bbox: BBox; indexes: number[] } | null {
  const tol = Math.max(14, pageW * 0.035);
  type Row = { index: number; cells: { text: string; x0: number }[]; bbox: BBox };
  const rows: Row[] = [];
  lines.forEach((line, index) => {
    if (looksLikeMath(line.text) || line.words.length < 2) return;
    rows.push({
      index,
      bbox: line.bbox,
      cells: line.words.map((w) => ({ text: w.text.trim(), x0: w.x0 })),
    });
  });
  let best: Row[] | null = null;
  for (let i = 0; i < rows.length; i++) {
    const group = [rows[i]];
    for (let j = i + 1; j < rows.length; j++) {
      const prev = group[group.length - 1];
      const next = rows[j];
      if (next.cells.length !== prev.cells.length || next.cells.length < 2) break;
      const aligned = next.cells.every((cell, k) => Math.abs(cell.x0 - prev.cells[k].x0) <= tol);
      const gap = next.bbox[1] - prev.bbox[3];
      const height = Math.max(8, prev.bbox[3] - prev.bbox[1]);
      if (!aligned || gap > height * 1.8) break;
      group.push(next);
    }
    if (group.length >= 3 && (!best || group.length > best.length)) best = group;
  }
  if (!best) return null;
  return {
    rows: best.map((row) => row.cells.map((cell) => cell.text)),
    bbox: union(best.map((row) => row.bbox)),
    indexes: best.map((row) => row.index),
  };
}

function components(mask: Uint8Array, w: number, h: number): { bbox: BBox; area: number }[] {
  const seen = new Uint8Array(mask.length);
  const out: { bbox: BBox; area: number }[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.push(start);
    seen[start] = 1;
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let area = 0;
    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % w;
      const y = (p / w) | 0;
      area++;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x + 1 > x1) x1 = x + 1;
      if (y + 1 > y1) y1 = y + 1;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        stack.push(p - 1);
      }
      if (x + 1 < w && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        stack.push(p + 1);
      }
      if (y > 0 && mask[p - w] && !seen[p - w]) {
        seen[p - w] = 1;
        stack.push(p - w);
      }
      if (y + 1 < h && mask[p + w] && !seen[p + w]) {
        seen[p + w] = 1;
        stack.push(p + w);
      }
    }
    out.push({ bbox: [x0, y0, x1, y1], area });
  }
  return out;
}

function mergeBoxes(boxes: BBox[], gap: number): BBox[] {
  const left = boxes.map((b) => [b[0], b[1], b[2], b[3]] as BBox);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < left.length; i++) {
      for (let j = i + 1; j < left.length; j++) {
        if (!intersects(left[i], left[j], gap)) continue;
        left[i] = union([left[i], left[j]]);
        left.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return left;
}

function clearBox(mask: Uint8Array, w: number, h: number, box: BBox) {
  const x0 = Math.max(0, Math.floor(box[0]));
  const y0 = Math.max(0, Math.floor(box[1]));
  const x1 = Math.min(w, Math.ceil(box[2]));
  const y1 = Math.min(h, Math.ceil(box[3]));
  for (let y = y0; y < y1; y++) mask.fill(0, y * w + x0, y * w + x1);
}

function findPictures(img: Gray, occupied: BBox[], lineH: number): { bbox: BBox; role: "graph" | "equation" }[] {
  const small = downscale(img, 480);
  const mask = darkMask(small);
  for (const box of occupied) clearBox(mask, small.w, small.h, mapBox(box, img, small.w, small.h));
  const raw = components(mask, small.w, small.h);
  const boxes = raw
    .filter((c) => c.area > 40 && c.bbox[2] - c.bbox[0] > 6 && c.bbox[3] - c.bbox[1] > 6)
    .map((c) => mapBox(c.bbox, small, img.w, img.h));
  const merged = mergeBoxes(boxes, Math.max(16, img.w * 0.08));
  const pictures: { bbox: BBox; role: "graph" | "equation" }[] = [];
  for (const bbox of merged) {
    const bw = bbox[2] - bbox[0];
    const bh = bbox[3] - bbox[1];
    if (bw < img.w * 0.06 || bh < img.h * 0.025) continue;
    if (bw * bh < img.w * img.h * 0.004) continue;
    const role = bh < Math.max(28, lineH * 3.2) && bw < img.w * 0.72 ? "equation" : "graph";
    pictures.push({ bbox, role });
  }
  return pictures;
}

function pngOf(img: Gray, bbox: BBox, pad: number): Uint8Array {
  const x0 = Math.max(0, Math.floor(bbox[0] - pad));
  const y0 = Math.max(0, Math.floor(bbox[1] - pad));
  const x1 = Math.min(img.w, Math.ceil(bbox[2] + pad));
  const y1 = Math.min(img.h, Math.ceil(bbox[3] + pad));
  return encodeGrayPng(cropGray(img, x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)));
}

export function composeLayout(lines: OcrLine[], image: Gray | null): LayoutPiece[] {
  const pageW = image?.w || Math.max(1, ...lines.map((l) => l.bbox[2]));
  const pageH = image?.h || Math.max(1, ...lines.map((l) => l.bbox[3]));
  const rules = image ? detectRules(image) : { horizontal: [], vertical: [] };
  const pieces: LayoutPiece[] = [];
  const consumed = new Set<number>();

  for (const ruled of image ? tablesFromRules(lines, rules) : []) {
    pieces.push({ kind: "table", rows: ruled.rows, bbox: ruled.bbox });
    for (const index of ruled.used) consumed.add(index);
  }

  const open = lines.map((line, index) => ({ line, index })).filter((item) => !consumed.has(item.index) && !looksLikeMath(item.line.text));
  const spaced = whitespaceTable(open.map((item) => item.line), pageW);
  if (spaced) {
    pieces.push({ kind: "table", rows: spaced.rows, bbox: spaced.bbox });
    for (const local of spaced.indexes) consumed.add(open[local].index);
  }

  const heights = lines.map((l) => Math.max(1, l.bbox[3] - l.bbox[1])).sort((a, b) => a - b);
  const lineH = heights.length ? heights[(heights.length / 2) | 0] : 16;

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i) || !looksLikeMath(lines[i].text)) continue;
    consumed.add(i);
    const bbox = lines[i].bbox;
    pieces.push({
      kind: "image",
      role: "equation",
      text: lines[i].text,
      bbox,
      png: image ? pngOf(image, bbox, 6) : new Uint8Array(),
    });
  }

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i) || !lines[i].text.trim()) continue;
    const bbox = lines[i].bbox;
    const role = bbox[3] - bbox[1] > lineH * 1.45 && bbox[1] < pageH * 0.28 ? "title" : "body";
    pieces.push({ kind: "text", role, text: lines[i].text, bbox });
  }

  const occupied = pieces.map((p) => p.bbox);
  if (image) {
    for (const picture of findPictures(image, occupied, lineH)) {
      pieces.push({
        kind: "image",
        role: picture.role,
        text: "",
        bbox: picture.bbox,
        png: pngOf(image, picture.bbox, 4),
      });
    }
    for (const rule of rules.horizontal) {
      const bbox: BBox = [rule.x0, rule.y0, rule.x1, rule.y1];
      const length = bbox[2] - bbox[0];
      if (length < pageW * 0.28) continue;
      if (pieces.some((p) => (p.kind === "table" || p.kind === "image") && intersects(bbox, p.bbox, 3))) continue;
      pieces.push({ kind: "rule", bbox });
    }
  }

  return pieces.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
}

export function presentLayout(pieces: LayoutPiece[], pageW: number): PageLayoutBlock[] {
  return pieces.map((piece) => {
    if (piece.kind === "text") return { kind: "text", role: piece.role, text: piece.text };
    if (piece.kind === "rule") return { kind: "rule" };
    if (piece.kind === "table") return { kind: "table", rows: piece.rows };
    const width = pageW > 0 ? Math.max(0.18, Math.min(1, (piece.bbox[2] - piece.bbox[0]) / pageW)) : 0.6;
    return {
      kind: "image",
      role: piece.role,
      text: piece.text,
      src: piece.png.length ? pngDataUrl(piece.png) : "",
      width,
    };
  });
}

export function layoutNotes(blocks: PageLayoutBlock[]): string {
  const table = blocks.filter((b) => b.kind === "table").length;
  const rule = blocks.filter((b) => b.kind === "rule").length;
  const graph = blocks.filter((b) => b.kind === "image" && b.role === "graph").length;
  const equation = blocks.filter((b) => b.kind === "image" && b.role === "equation").length;
  const parts: string[] = [];
  if (table) parts.push(`表格 ${table}`);
  if (rule) parts.push(`橫線 ${rule}`);
  if (graph) parts.push(`圖表 ${graph}`);
  if (equation) parts.push(`算式 ${equation}`);
  return parts.length ? `已保留版面：${parts.join("、")}` : "";
}

function pngDataUrl(png: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < png.length; i += step) {
    binary += String.fromCharCode(...png.subarray(i, Math.min(png.length, i + step)));
  }
  const btoaFn = globalThis.btoa;
  return `data:image/png;base64,${btoaFn(binary)}`;
}
