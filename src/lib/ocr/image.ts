/** Grayscale document image helpers used before OCR. */

export type Gray = {
  w: number;
  h: number;
  d: Uint8Array;
};

export type PrepareOptions = {
  deskew: boolean;
  /** auto: binarize only when the page looks like a gray or uneven scan. */
  binarize: "auto" | "on" | "off";
};

export type PrepareResult = {
  gray: Gray;
  /** Degrees applied to straighten the page. */
  angle: number;
  binarized: boolean;
  notes: string[];
};

export function rgbaToGray(src: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const d = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i++, p += 4) {
    d[i] = (src[p] * 0.299 + src[p + 1] * 0.587 + src[p + 2] * 0.114) | 0;
  }
  return { w, h, d };
}

export function cloneGray(img: Gray): Gray {
  return { w: img.w, h: img.h, d: img.d.slice() };
}

function histogram(d: Uint8Array): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i++) hist[d[i]]++;
  return hist;
}

export function contrastStretch(img: Gray, low = 0.002, high = 0.99): Gray {
  const hist = histogram(img.d);
  const total = img.d.length;
  const at = (p: number) => {
    const target = Math.max(1, total * p);
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  };
  const paper = at(0.5);
  let lo = at(low);
  const hi = at(high);
  // Ink is often under 1% of a page. A higher black point is still paper,
  // and stretching that paper down to 0 turns the whole scan black.
  if (paper - lo < 40) lo = Math.max(0, paper - 40);
  if (hi <= lo + 10) return img;
  const scale = 255 / (hi - lo);
  const d = new Uint8Array(img.d.length);
  for (let i = 0; i < img.d.length; i++) {
    let v = (img.d[i] - lo) * scale;
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    d[i] = v | 0;
  }
  return { w: img.w, h: img.h, d };
}

export function otsuThreshold(d: Uint8Array): number {
  const hist = histogram(d);
  const total = d.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let max = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) {
      max = between;
      threshold = t;
    }
  }
  return threshold;
}

/** Local adaptive threshold. Ink becomes 0, background 255. */
export function sauvola(img: Gray, radius = 20, k = 0.2, r = 128): Gray {
  const { w, h, d } = img;
  const stride = w + 1;
  const ii = new Float64Array(stride * (h + 1));
  const sq = new Float64Array(stride * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    let rowSq = 0;
    const src = (y - 1) * w;
    const dst = y * stride;
    const prev = (y - 1) * stride;
    for (let x = 1; x <= w; x++) {
      const v = d[src + x - 1];
      row += v;
      rowSq += v * v;
      ii[dst + x] = ii[prev + x] + row;
      sq[dst + x] = sq[prev + x] + rowSq;
    }
  }
  const out = new Uint8Array(d.length);
  const rect = (I: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    I[y1 * stride + x1] - I[y0 * stride + x1] - I[y1 * stride + x0] + I[y0 * stride + x0];

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const n = (x1 - x0) * (y1 - y0);
      const sum = rect(ii, x0, y0, x1, y1);
      const sumSq = rect(sq, x0, y0, x1, y1);
      const mean = sum / n;
      const variance = Math.max(0, sumSq / n - mean * mean);
      const std = Math.sqrt(variance);
      const thr = mean * (1 + k * (std / r - 1));
      out[y * w + x] = d[y * w + x] < thr ? 0 : 255;
    }
  }
  return { w, h, d: out };
}

export function removeSpecks(img: Gray): Gray {
  const { w, h, d } = img;
  const out = d.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (d[i] > 127) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const row = (y + dy) * w;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (d[row + x + dx] < 128) n++;
        }
      }
      if (n < 2) out[i] = 255;
    }
  }
  return { w, h, d: out };
}

function boxBlur3(img: Gray): Gray {
  const { w, h, d } = img;
  const tmp = new Uint8Array(d.length);
  const out = new Uint8Array(d.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x + 1 < w ? x + 1 : x;
      tmp[row + x] = ((d[row + x0] + d[row + x] + d[row + x1]) / 3) | 0;
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = (y > 0 ? y - 1 : y) * w;
    const y1 = (y + 1 < h ? y + 1 : y) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      out[row + x] = ((tmp[y0 + x] + tmp[row + x] + tmp[y1 + x]) / 3) | 0;
    }
  }
  return { w, h, d: out };
}

export function unsharp(img: Gray, amount = 0.55): Gray {
  const blur = boxBlur3(img);
  const d = new Uint8Array(img.d.length);
  for (let i = 0; i < d.length; i++) {
    let v = img.d[i] + amount * (img.d[i] - blur.d[i]);
    if (v < 0) v = 0;
    else if (v > 255) v = 255;
    d[i] = v | 0;
  }
  return { w: img.w, h: img.h, d };
}

export function downscale(img: Gray, maxEdge: number): Gray {
  const edge = Math.max(img.w, img.h);
  if (edge <= maxEdge) return img;
  const scale = maxEdge / edge;
  const w = Math.max(1, Math.round(img.w * scale));
  const h = Math.max(1, Math.round(img.h * scale));
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor((y * img.h) / h);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * img.h) / h));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor((x * img.w) / w);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * img.w) / w));
      let sum = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy += Math.max(1, (sy1 - sy0) >> 2)) {
        const row = sy * img.w;
        for (let sx = sx0; sx < sx1; sx += Math.max(1, (sx1 - sx0) >> 2)) {
          sum += img.d[row + sx];
          n++;
        }
      }
      d[y * w + x] = n ? (sum / n) | 0 : 0;
    }
  }
  return { w, h, d };
}

/** Variance of ink along rows. Higher means the text lines are horizontal. */
export function horizontalLineEnergy(img: Gray): number {
  const thr = otsuThreshold(img.d);
  const rows = new Float64Array(img.h);
  for (let y = 0; y < img.h; y++) {
    const row = y * img.w;
    let ink = 0;
    for (let x = 0; x < img.w; x += 2) if (img.d[row + x] <= thr) ink++;
    rows[y] = ink;
  }
  // Row-to-row change, not raw variance. A smooth shade becomes a ramp
  // after a quarter turn and used to outscore real text lines.
  let score = 0;
  for (let y = 1; y < img.h; y++) {
    const diff = rows[y] - rows[y - 1];
    score += diff * diff;
  }
  return score / img.h;
}

export function rotate90(img: Gray, turns: 1 | 2 | 3): Gray {
  const { w, h, d } = img;
  if (turns === 2) {
    const out = new Uint8Array(d.length);
    for (let i = 0; i < d.length; i++) out[d.length - 1 - i] = d[i];
    return { w, h, d: out };
  }
  const nw = h;
  const nh = w;
  const out = new Uint8Array(nw * nh);
  if (turns === 1) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[x * nw + (h - 1 - y)] = d[y * w + x];
    }
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) out[(w - 1 - x) * nw + y] = d[y * w + x];
    }
  }
  return { w: nw, h: nh, d: out };
}

/**
 * Rotate around the center. Positive degrees are clockwise in image space
 * (y grows downward). Empty corners are filled with white.
 */
export function rotateGray(img: Gray, deg: number): Gray {
  if (Math.abs(deg) < 0.05) return img;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { w, h, d } = img;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const corners: Array<[number, number]> = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of corners) {
    const dx = x - cx;
    const dy = y - cy;
    const rx = cos * dx - sin * dy + cx;
    const ry = sin * dx + cos * dy + cy;
    if (rx < minX) minX = rx;
    if (rx > maxX) maxX = rx;
    if (ry < minY) minY = ry;
    if (ry > maxY) maxY = ry;
  }
  const nw = Math.max(1, Math.round(maxX - minX) + 1);
  const nh = Math.max(1, Math.round(maxY - minY) + 1);
  const out = new Uint8Array(nw * nh);
  out.fill(255);
  for (let oy = 0; oy < nh; oy++) {
    const destY = minY + oy;
    const dy = destY - cy;
    for (let ox = 0; ox < nw; ox++) {
      const destX = minX + ox;
      const dx = destX - cx;
      const sx = cos * dx + sin * dy + cx;
      const sy = -sin * dx + cos * dy + cy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue;
      const tx = sx - x0;
      const ty = sy - y0;
      const i = y0 * w + x0;
      const v =
        d[i] * (1 - tx) * (1 - ty) +
        d[i + 1] * tx * (1 - ty) +
        d[i + w] * (1 - tx) * ty +
        d[i + w + 1] * tx * ty;
      out[oy * nw + ox] = v < 0 ? 0 : v > 255 ? 255 : (v | 0);
    }
  }
  return { w: nw, h: nh, d: out };
}

function projectionScore(binInk: Uint8Array, w: number, h: number, deg: number): number {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const rows = new Float64Array(h);
  const step = w > 500 ? 2 : 1;
  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    let ink = 0;
    for (let x = 0; x < w; x += step) {
      const dx = x - cx;
      const sx = (cos * dx + sin * dy + cx) | 0;
      const sy = (-sin * dx + cos * dy + cy) | 0;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      if (binInk[sy * w + sx]) ink++;
    }
    rows[y] = ink;
  }
  let mean = 0;
  for (let y = 0; y < h; y++) mean += rows[y];
  mean /= h;
  let v = 0;
  for (let y = 0; y < h; y++) {
    const diff = rows[y] - mean;
    v += diff * diff;
  }
  return v / h;
}

/** Dark strokes only. A global threshold treats a gray gradient as one big ink blob. */
function strokeInk(img: Gray): Uint8Array {
  const { w, h, d } = img;
  const ink = new Uint8Array(d.length);
  const gap = Math.max(2, Math.round(Math.min(w, h) / 180));
  for (let y = gap; y < h - gap; y++) {
    const row = y * w;
    for (let x = gap; x < w - gap; x++) {
      const v = d[row + x];
      // Max, not min: a horizontal stroke is dark on both sides, and only
      // the pixels above and below it are paper.
      const paper = Math.max(
        d[row + x - gap],
        d[row + x + gap],
        d[row - gap * w + x],
        d[row + gap * w + x],
      );
      if (paper - v >= 24) ink[row + x] = 1;
    }
  }
  return ink;
}

/** Degrees (clockwise) that straighten near-horizontal text. 0 if already straight. */
export function detectSkew(img: Gray): number {
  const small = downscale(img, 720);
  const ink = strokeInk(small);
  const base = projectionScore(ink, small.w, small.h, 0);
  let best = 0;
  let bestScore = base;
  for (let deg = -7; deg <= 7.001; deg += 0.5) {
    if (Math.abs(deg) < 0.01) continue;
    const score = projectionScore(ink, small.w, small.h, deg);
    if (score > bestScore) {
      bestScore = score;
      best = deg;
    }
  }
  if (best === 0 || bestScore < base * 1.04) return 0;
  // refine ±0.4 around the coarse winner
  let refined = best;
  let refinedScore = bestScore;
  for (let deg = best - 0.4; deg <= best + 0.4; deg += 0.2) {
    const score = projectionScore(ink, small.w, small.h, deg);
    if (score > refinedScore) {
      refinedScore = score;
      refined = Math.round(deg * 10) / 10;
    }
  }
  return refinedScore < base * 1.04 ? 0 : refined;
}

export function pageLooksSideways(img: Gray): boolean {
  const small = downscale(img, 480);
  const upright = horizontalLineEnergy(small);
  const turned = horizontalLineEnergy(rotate90(small, 1));
  return turned > upright * 1.25 && turned > upright + 1;
}

function percentile(img: Gray, p: number): number {
  const hist = histogram(img.d);
  const target = Math.max(1, Math.floor(img.d.length * p));
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

function shouldBinarize(img: Gray, mode: PrepareOptions["binarize"]): boolean {
  if (mode === "off") return false;
  if (mode === "on") return true;
  // Ink is often well under 1% of a page, so a 1% percentile still reads the paper.
  const dark = percentile(img, 0.002);
  const paper = percentile(img, 0.5);
  // Local thresholding eats thin strokes on gray paper that is already readable.
  // Use it for faint type or a genuinely dark photograph.
  if (paper < 140) return true;
  return paper - dark < 60;
}

export function preparePage(img: Gray, opts: PrepareOptions): PrepareResult {
  const notes: string[] = [];
  let angle = 0;
  let gray = img;
  if (opts.deskew) {
    angle = detectSkew(img);
    if (angle) {
      gray = rotateGray(img, angle);
      notes.push(`已把頁面轉正 ${angle.toFixed(1)}°`);
    }
  }
  const binarized = shouldBinarize(gray, opts.binarize);
  if (binarized) {
    gray = removeSpecks(sauvola(gray, gray.w > 2000 ? 22 : 15, 0.22));
    notes.push("已做局部二值化，壓掉灰底與污點");
  } else {
    gray = unsharp(contrastStretch(gray));
    notes.push("已拉對比並輕微銳化");
  }
  return { gray, angle, binarized, notes };
}

/** PNG encoder for 8-bit grayscale. Uses stored (uncompressed) zlib blocks. */
export function encodeGrayPng(img: Gray): Uint8Array {
  const { w, h, d } = img;
  const rowBytes = w + 1;
  const raw = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) {
    const dest = y * rowBytes;
    raw[dest] = 0;
    raw.set(d.subarray(y * w, y * w + w), dest + 1);
  }
  const z = zlibStore(raw);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, w);
  view.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const chunks = [
    chunk("IHDR", ihdr),
    chunk("IDAT", z),
    chunk("IEND", new Uint8Array(0)),
  ];
  const size = 8 + chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(size);
  out.set([137, 80, 78, 71, 13, 10, 26, 10]);
  let o = 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  let adler = 1;
  const max = 65535;
  for (let i = 0; i < data.length; i += max) {
    const slice = data.subarray(i, Math.min(data.length, i + max));
    const last = i + max >= data.length;
    const header = new Uint8Array(5 + slice.length);
    header[0] = last ? 1 : 0;
    header[1] = slice.length & 255;
    header[2] = (slice.length >> 8) & 255;
    const nlen = slice.length ^ 0xffff;
    header[3] = nlen & 255;
    header[4] = (nlen >> 8) & 255;
    header.set(slice, 5);
    blocks.push(header);
    adler = adler32Update(adler, slice);
  }
  if (!blocks.length) {
    blocks.push(new Uint8Array([1, 0, 0, 255, 255]));
  }
  const body = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(2 + body + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  const view = new DataView(out.buffer);
  view.setUint32(out.length - 4, adler);
  return out;
}

function adler32Update(sum: number, data: Uint8Array): number {
  let a = sum & 0xffff;
  let b = (sum >>> 16) & 0xffff;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function cropGray(img: Gray, x: number, y: number, w: number, h: number): Gray {
  const x0 = Math.max(0, Math.min(img.w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(img.h - 1, Math.floor(y)));
  const cw = Math.max(1, Math.min(img.w - x0, Math.floor(w)));
  const ch = Math.max(1, Math.min(img.h - y0, Math.floor(h)));
  const d = new Uint8Array(cw * ch);
  for (let row = 0; row < ch; row++) {
    d.set(img.d.subarray((y0 + row) * img.w + x0, (y0 + row) * img.w + x0 + cw), row * cw);
  }
  return { w: cw, h: ch, d };
}
