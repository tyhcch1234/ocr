import { PSM } from "tesseract.js";
import {
  cropGray,
  downscale,
  encodeGrayPng,
  pageLooksSideways,
  preparePage,
  rotate90,
  type Gray,
  type PrepareOptions,
  type PrepareResult,
} from "./image";
import {
  groupLines,
  linesToText,
  meanConfidence,
  normalizeLine,
  usefulWords,
  type OcrLine,
  type OcrWord,
} from "./reconstruct";

export type RecognizeEngine = {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(
    image: Buffer | Blob,
    options?: object,
    output?: { text?: boolean; blocks?: boolean },
  ): Promise<{
    data: {
      text: string | null;
      confidence: number | null;
      blocks: unknown;
    };
  }>;
};

export type PageOcr = {
  lines: OcrLine[];
  text: string;
  confidence: number;
  binarized: boolean;
  angle: number;
  notes: string[];
  /** Small grayscale image of what was actually recognized. */
  preview: Gray;
  /** Full page that was recognized. Layout crops charts and formulas from it. */
  image: Gray;
  doubtful: string[];
};

export type OcrTune = PrepareOptions & {
  autoRotate: boolean;
};

export type Preparer = (img: Gray, opts: PrepareOptions) => PrepareResult | Promise<PrepareResult>;

function imageInput(img: Gray): Buffer | Blob {
  const png = encodeGrayPng(img);
  const copy = new ArrayBuffer(png.byteLength);
  new Uint8Array(copy).set(png);
  if (typeof window === "undefined") return Buffer.from(copy);
  return new Blob([copy], { type: "image/png" });
}

function boxOf(b: unknown): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, number>;
  if ([o.x0, o.y0, o.x1, o.y1].every((n) => Number.isFinite(n))) {
    return { x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1 };
  }
  if ([o.x, o.y, o.width, o.height].every((n) => Number.isFinite(n))) {
    return { x0: o.x, y0: o.y, x1: o.x + o.width, y1: o.y + o.height };
  }
  return null;
}

function wordFrom(o: Record<string, unknown>): OcrWord | null {
  const box = boxOf(o.bbox) || boxOf(o.bounding_box) || boxOf(o.box);
  if (!box || typeof o.text !== "string") return null;
  const conf = typeof o.confidence === "number" ? o.confidence : 0;
  return { text: o.text, conf, ...box };
}

export function collectWords(node: unknown, out: OcrWord[] = [], depth = 0): OcrWord[] {
  if (!node || depth > 14) return out;
  if (Array.isArray(node)) {
    for (const item of node) collectWords(item, out, depth + 1);
    return out;
  }
  if (typeof node !== "object") return out;
  const o = node as Record<string, unknown>;
  if (Array.isArray(o.symbols) && typeof o.text === "string") {
    const word = wordFrom(o);
    if (word) out.push(word);
    return out;
  }
  let descended = false;
  for (const key of ["words", "lines", "paragraphs", "blocks"] as const) {
    if (Array.isArray(o[key])) {
      collectWords(o[key], out, depth + 1);
      descended = true;
    }
  }
  if (descended) return out;
  if (typeof o.text === "string") {
    const word = wordFrom(o);
    if (word) out.push(word);
  }
  return out;
}

function fallbackText(text: string | null): string {
  return (text || "")
    .split(/\n+/)
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .join("\n");
}

function quality(text: string, confidence: number): number {
  const letters = text.replace(/\s/g, "").length;
  return confidence * Math.min(1, letters / 8) + Math.min(40, letters * 0.8);
}

async function runOnce(worker: RecognizeEngine, img: Gray, dpi: number, psm: string) {
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    user_defined_dpi: String(Math.max(70, Math.round(dpi))),
    preserve_interword_spaces: "1",
  });
  const res = await worker.recognize(imageInput(img), {}, { text: true, blocks: true });
  const words = usefulWords(collectWords(res.data.blocks));
  const lines = groupLines(words, img.w);
  const text = lines.length ? linesToText(lines) : fallbackText(res.data.text);
  const confidence = lines.length ? meanConfidence(lines) : res.data.confidence || 0;
  return { lines, text, confidence, words };
}

function centerBand(img: Gray): Gray {
  const bandH = Math.max(32, Math.min(img.h, Math.round(img.h * 0.36)));
  const bandW = Math.max(32, Math.min(img.w, 1400));
  const y = Math.round((img.h - bandH) / 2);
  const x = Math.round((img.w - bandW) / 2);
  return cropGray(img, x, y, bandW, bandH);
}

function doubtfulWords(words: OcrWord[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const t = w.text.trim();
    if (!t || w.conf >= 62 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * Deskew, optionally binarize, fix a sideways or upside-down page, then recognize.
 * A weak first pass is retried with the other thresholding mode.
 */
export async function ocrGray(
  worker: RecognizeEngine,
  source: Gray,
  dpi: number,
  opts: OcrTune,
  prepare: Preparer = preparePage,
): Promise<PageOcr> {
  const notes: string[] = [];
  let base = source;

  if (opts.autoRotate && pageLooksSideways(source)) {
    const upright = await runOnce(worker, centerBand(source), dpi, PSM.SINGLE_BLOCK);
    const cw = rotate90(source, 1);
    const ccw = rotate90(source, 3);
    const a = await runOnce(worker, centerBand(cw), dpi, PSM.SINGLE_BLOCK);
    const b = await runOnce(worker, centerBand(ccw), dpi, PSM.SINGLE_BLOCK);
    const upQ = quality(upright.text, upright.confidence);
    const aQ = quality(a.text, a.confidence);
    const bQ = quality(b.text, b.confidence);
    if (Math.max(aQ, bQ) > upQ + 8) {
      base = aQ >= bQ ? cw : ccw;
      notes.push("頁面是橫放的，已轉成直向");
    }
  }

  const primaryPrep = await prepare(base, opts);
  notes.push(...primaryPrep.notes);
  let used = primaryPrep.gray;
  let binarized = primaryPrep.binarized;
  let best = await runOnce(worker, used, dpi, PSM.AUTO);

  if (best.confidence < 50 || best.text.replace(/\s/g, "").length < 4) {
    // Keep the deskew already applied. Turning it off again compares a
    // straightened page with the original skew, which is a different question.
    const altPrep = await prepare(used, {
      deskew: false,
      binarize: binarized ? "off" : "on",
    });
    const alt = await runOnce(
      worker,
      altPrep.gray,
      dpi,
      best.text.replace(/\s/g, "").length < 4 ? PSM.SPARSE_TEXT : PSM.AUTO,
    );
    if (quality(alt.text, alt.confidence) > quality(best.text, best.confidence) + 3) {
      best = alt;
      used = altPrep.gray;
      binarized = altPrep.binarized;
      notes.push(binarized ? "改用局部二值化後再辨一次" : "灰階版本比較清楚，改採用它");
    }
  }

  if (opts.autoRotate && best.confidence < 45 && best.text.replace(/\s/g, "").length < 12) {
    const flipped = rotate90(base, 2);
    const prep = await prepare(flipped, { ...opts, deskew: opts.deskew });
    const alt = await runOnce(worker, prep.gray, dpi, PSM.AUTO);
    if (quality(alt.text, alt.confidence) > quality(best.text, best.confidence) + 8) {
      best = alt;
      used = prep.gray;
      binarized = prep.binarized;
      notes.push("頁面上下顛倒，已翻轉");
    }
  }

  return {
    lines: best.lines,
    text: best.text,
    confidence: Math.round(best.confidence),
    binarized,
    angle: primaryPrep.angle,
    notes,
    preview: downscale(used, 720),
    image: used,
    doubtful: doubtfulWords(best.words),
  };
}
